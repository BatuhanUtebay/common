import { CancelToken, DisposeContainer, aryRemoveItem, createPromiseSource, deepClone, getErrorMessage, pushBehaviorSubjectAry, shortUuid, zodCoerceObject } from "@iyio/common";
import { BehaviorSubject, Observable, Subject } from "rxjs";
import { ZodType } from "zod";
import { Conversation, ConversationOptions } from "./Conversation";
import { createConvoNodeExecCtxAsync } from "./convo-graph-lib";
import { ConvoEdge, ConvoEdgePattern, ConvoGraphMonitorEvent, ConvoGraphStore, ConvoNode, ConvoNodeExeState, ConvoNodeExecCtx, ConvoNodeExecCtxStep, ConvoNodeStep, ConvoTraverser, ConvoTraverserGroup, CreateConvoTraverserOptions, StartConvoTraversalOptions } from "./convo-graph-types";
import { convoTags } from "./convo-lib";
import { convoScript } from "./convo-template";
import { ConvoFnCallInfo } from "./convo-types";
import { convoGraphStore } from "./convo.deps";

export interface ConvoGraphCtrlOptions
{
    store?:ConvoGraphStore;
    convoOptions?:ConversationOptions;
}

export class ConvoGraphCtrl
{
    public readonly store:ConvoGraphStore;

    private readonly _onMonitorEvent=new Subject<ConvoGraphMonitorEvent>();
    public get onMonitorEvent():Observable<ConvoGraphMonitorEvent>{return this._onMonitorEvent}
    private get hasListeners(){return this._onMonitorEvent.observed}
    private triggerEvent(evt:Omit<ConvoGraphMonitorEvent,'time'>)
    {
        (evt as ConvoGraphMonitorEvent).time=Date.now();
        this._onMonitorEvent.next((evt as ConvoGraphMonitorEvent));
    }

    private readonly defaultConvoOptions:ConversationOptions;
    private async getConvoOptionsAsync(tv:ConvoTraverser|undefined,initConvo?:string):Promise<ConversationOptions>{

        return {
            ...this.defaultConvoOptions,
            disableAutoFlatten:true,
            initConvo:((await this.getSharedSourceAsync())+(
                (
                    initConvo?
                        (
                            this.defaultConvoOptions.initConvo?
                                `${this.defaultConvoOptions.initConvo}\n\n${initConvo}`
                            :
                                initConvo
                        )
                    :
                        this.defaultConvoOptions.initConvo
                )||''
            ))||undefined,
            defaultVars:{
                ...this.defaultConvoOptions.defaultVars,
                input:tv?.payload,
                sourceInput:tv?.payload,
                tState:tv?.state,
                graphCtrl:this,
            }
        }
    }

    public constructor({
        store=convoGraphStore(),
        convoOptions={}
    }:ConvoGraphCtrlOptions){
        this.store=store;
        this.defaultConvoOptions=convoOptions;
    }

    private readonly disposables=new DisposeContainer();
    private _isDisposed=false;
    public get isDisposed(){return this._isDisposed}
    public dispose()
    {
        if(this._isDisposed){
            return;
        }
        this.disposables.dispose();
        this._isDisposed=true;
    }

    public async startRunAsync(options:StartConvoTraversalOptions)
    {
        const tv=await this.startTraversalAsync(options);
        await this.runGroupAsync(tv);
        return tv;
    }

    public async startTraversalAsync({
        createTvOptions,
        edge,
        edgePattern,
        payload={},
        state,
        saveToStore=false,
        cancel=new CancelToken(),
    }:StartConvoTraversalOptions):Promise<ConvoTraverserGroup>{

        if(typeof edge === 'string'){
            edge={
                id:shortUuid(),
                to:edge,
                from:''
            }
        }

        let edges:ConvoEdge[];

        if(edge){
            edges=[edge];
        }else if(edgePattern){
            edges=await this.getEdgesAsync(edgePattern);
        }else{
            edges=[];
        }

        const traversers=await Promise.all(edges.map((edge)=>this.createTvAsync(edge,createTvOptions,payload,state,saveToStore)));

        return {
            traversers:new BehaviorSubject(traversers),
            saveToStore,
            createTvOptions,
            cancel
        }
    }

    private async createTvAsync(
        edge:ConvoEdge,
        options:CreateConvoTraverserOptions|undefined,
        payload:any,
        state:Record<string,any>|undefined,
        saveToStore:boolean,
        addTo?:BehaviorSubject<ConvoTraverser[]>
    ){
        const defaults=options?.defaults;
        const tv:ConvoTraverser={
            ...defaults,
            id:defaults?.id??shortUuid(),
            exeState:'invoked',
            state:defaults?.state??{},
            currentStepIndex:0,
        }

        tv.payload=payload;
        if(state){
            for(const e in state){
                tv.state[e]=state[e];
            }
        }

        if(saveToStore){
            await this.store.putTraverserAsync(tv);
        }

        if(this.hasListeners){
            this.triggerEvent({
                type:'start-traversal',
                text:'Graph traversal started',
                traverser:tv
            })
        }

        await this.traverseEdgeAsync(tv,edge);
        if(addTo){
            pushBehaviorSubjectAry(addTo,tv);
        }
        return tv;
    }

    /**
     * Moves the traverser to the "to" side of the edge and updates the traversers execution state.
     * If the target node of the edge can not be found the traverser's execution state will be
     * set to failed.
     */
    private async traverseEdgeAsync(tv:ConvoTraverser,edge:ConvoEdge):Promise<ConvoNode|undefined>{

        if(tv.exeState!=='invoked'){
            throw new Error('ConvoTraverser execution state must be set to `invoked` before traversing an edge');
        }

        edge=deepClone(edge);

        const targetNode=await this.store.getNodeAsync(edge.to);

        if(!targetNode){
            tv.exeState='failed';
            tv.errorMessage=`Target to node with id ${edge.to} does not exist`;
            if(this.hasListeners){
                this.triggerEvent({
                    type:'traversal-failed',
                    text:tv.errorMessage,
                    traverser:tv,
                    edge
                })
            }
            return undefined;
        }

        tv.currentNodeId=targetNode.id;

        if(edge.pause){
            tv.exeState='paused';
            tv.pause=edge.pause;
            if(tv.pause.delayMs!==undefined){
                tv.resumeAt=Date.now()+tv.pause.delayMs;
            }else{
                delete tv.resumeAt;
            }
        }else{
            tv.exeState='ready';
            delete tv.resumeAt;
            delete tv.pause;
        }

        if(!tv.path){
            tv.path=[];
        }
        tv.path.push(edge);

        if(this.hasListeners){
            this.triggerEvent({
                type:'edge-crossed',
                text:'Traverser crossed edge',
                pause:tv.pause?{...tv.pause}:undefined,
                traverser:tv,
                edge,
                node:targetNode
            })
        }

        return targetNode;
    }

    public async runGroupAsync(group:ConvoTraverserGroup):Promise<void>
    {
        const running:ConvoTraverser[]=[];
        const runPromises:Promise<ConvoNodeExeState>[]=[];

        const startSrc=createPromiseSource<void>();

        const sub=group.traversers.subscribe(ary=>{
            for(const t of ary){
                if(!running.includes(t)){
                    running.push(t);
                    const runP=this.runAsync(t,group);
                    runPromises.push(runP);
                    runP.then(()=>{
                        aryRemoveItem(runPromises,runP);
                    })
                }
            }
            startSrc.resolve();
        });

        await startSrc.promise;
        while(runPromises.length){
            await Promise.all(runPromises);
        }
        sub.unsubscribe();
    }

    public async runAsync(tv:ConvoTraverser,group?:ConvoTraverserGroup):Promise<ConvoNodeExeState>{
        while((await this.nextAsync(tv,group))==='ready' && !group?.cancel.isCanceled){
            // do nothing
        }
        return tv.exeState;
    }

    /**
     * Executes the current node the traverser in on then traverses to the next node or stops if
     * no matching edges are found.
     */
    public async nextAsync(tv:ConvoTraverser,group?:ConvoTraverserGroup):Promise<ConvoNodeExeState>{

        if(tv.exeState!=='ready'){
            throw new Error('ConvoTraverser execution state must be set to `ready` before executing a node');
        }

        if(!tv.currentNodeId){
            throw new Error('ConvoTraverser does not have its currentNodeId set');
        }

        try{
            const newState=await this._nextAsync(tv,group);
            if(newState==='failed'){
                if(this.hasListeners){
                    this.triggerEvent({
                        type:'traversal-failed',
                        text:tv.errorMessage??'Traversal failed',
                        traverser:tv,
                    })
                }
            }
            return newState;
        }catch(ex){
            tv.currentStepIndex=0;
            //throw errors can be retired
            if(this.hasListeners){
                this.triggerEvent({
                    type:'traversal-failed',
                    text:getErrorMessage(ex),
                    traverser:tv,
                })
            }
            return 'failed';
        }

    }

    private async _nextAsync(tv:ConvoTraverser,group?:ConvoTraverserGroup):Promise<ConvoNodeExeState>{

        const node=await this.store.getNodeAsync(tv.currentNodeId??'');

        if(!node){
            tv.exeState='failed';
            tv.errorMessage=`Target node with id ${tv.currentNodeId} not found while trying to execute`;
            return tv.exeState;
        }


        if(this.hasListeners){
            this.triggerEvent({
                type:'start-exe',
                text:'Starting execution of node',
                traverser:tv,
                node,
            })
        }

        const exeCtx=await createConvoNodeExecCtxAsync(node,await this.getConvoOptionsAsync(tv));

        // transform input
        let transformStep:ConvoNodeExecCtxStep|null=null;
        if(exeCtx.metadata.inputType?.name){

            const inputType=exeCtx.typeMap[exeCtx.metadata.inputType.name];
            if(inputType){
                transformStep=await this.transformInputAsync(tv,node,inputType,exeCtx);
            }else{
                tv.exeState='failed';
                tv.errorMessage='Input type not found for transforming';
            }

            if(tv.exeState==='failed'){
                return 'failed';
            }
        }

        let invokeCall:ConvoFnCallInfo|undefined;
        tv.exeState='invoking';
        for(let i=transformStep?-1:0;i<exeCtx.steps.length;i++){
            const step=i===-1?transformStep:exeCtx.steps[i];
            if(!step){continue}
            tv.currentStepIndex=i;
            invokeCall=await this.executeStepAsync(tv,node,step,i,exeCtx);

            if((tv.exeState as ConvoNodeExeState)==='failed'){
                tv.currentStepIndex=0;
                return 'failed';
            }
        }
        tv.currentStepIndex=0;


        tv.exeState='invoked';

        const edges=await this.getEdgesAsync({
            from:node.id,
            fromFn:invokeCall?.name,
            fromType:invokeCall?.fn.returnType,
            input:tv.payload
        });

        if(edges.length){
            await Promise.all(edges.map((edge,i)=>{
                if(i===0){
                    return this.traverseEdgeAsync(tv,edge);
                }
                // create fork
                return this.createTvAsync(
                    edge,
                    group?.createTvOptions,
                    tv.payload,
                    tv.state,
                    group?.saveToStore??false,
                    group?.traversers
                )
            }))

        }else{
            tv.exeState='stopped';
            this.triggerEvent({
                type:'traversal-stopped',
                text:'Traversal stopped',
                traverser:tv,
                node,
            })
        }

        return tv.exeState;
    }

    /**
     * Returns all edges that match the given pattern
     */
    public async getEdgesAsync({
        from,
        fromType,
        fromFn,
        input
    }:ConvoEdgePattern):Promise<ConvoEdge[]>{
        let edges=await this.store.getNodeEdgesAsync(from,'from');
        if(fromType || fromFn){
            edges=edges.filter(e=>(
                ((fromType && e.fromType)?e.fromType===fromType:true) &&
                ((fromFn && e.fromFn)?e.fromFn===fromFn:true)
            ))
        }
        for(let i=0;i<edges.length;i++){
            const edge=edges[i];
            if(!edge?.conditionConvo){continue}
            try{
                const conversation=new Conversation({
                    disableAutoFlatten:true,
                    initConvo:(await this.getSharedSourceAsync())+edge.conditionConvo,
                    defaultVars:{input},
                })
                const flat=await conversation.flattenAsync();
                const accept=flat.exe.getVar('accept');
                if(!accept){
                    edges.splice(i,1);
                    i--;
                }
            }catch(ex){
                console.error('Edge condition error',edge,ex);
                edges.splice(i,1);
                i--;
            }


        }

        return edges;

    }

    private async getSharedSourceAsync():Promise<string>
    {
        const nodes=(await this.store.getSourceNodesAsync()).filter(s=>s.shared);
        if(!nodes.length){
            return '';
        }
        return nodes.map(n=>n.source??'').join('\n\n')+'\n\n';
    }


    private async transformInputAsync(
        tv:ConvoTraverser,
        node:ConvoNode,
        inputType:ZodType<any>,
        exeCtx:ConvoNodeExecCtx
    ):Promise<ConvoNodeExecCtxStep|null>{

        const parsed=inputType.safeParse(tv.payload);
        if(parsed.success){
            tv.payload=parsed.data;
        }else{
            const co=zodCoerceObject(
                inputType,
                (((typeof tv.payload === 'object') && tv.payload)?
                    tv.payload
                :
                    {value:tv.payload}
                )
            );
            if(co.error){

                if(!node.disableAutoTransform){

                    const transformStep:ConvoNodeStep={
                        name:'Auto transform',
                        convo:convoScript`

                            @output
                            # Sets the current input to the newly transformed input
                            > setConverted() Input -> (
                                return(__args)
                            )

                            @errorCallback
                            # Call this function if you are unable to convert the arguments
                            > conversionFailed(
                                errorMessage?:string
                            ) -> (
                                return(or(errorMessage 'failed'))
                            )

                            > user
                            Call the setConverted function using the sourceInput below.
                            Convert the sourceInput as needed to match the parameters of setConverted.

                            sourceInput:
                            {{input}}
                        `
                    }

                    if(this.hasListeners){
                        this.triggerEvent({
                            type:'auto-transformer-created',
                            text:`Auto transformer created`,
                            traverser:tv,
                            node,
                            step:transformStep
                        });
                    }
                    return {
                        nodeStep:transformStep,
                        convo:new Conversation({
                            ...this.getConvoOptionsAsync(tv),
                            defaultVars:exeCtx.defaultVars,
                            initConvo:(
                                (await this.getSharedSourceAsync())+
                                (node.sharedConvo?node.sharedConvo+'\n\n':'')+
                                transformStep.convo
                            )
                        })
                    };
                }

            }else{
                tv.payload=co.result;
            }
        }
        exeCtx.defaultVars['input']=tv.payload;

        return null;
    }

    private async executeStepAsync(
        tv:ConvoTraverser,
        node:ConvoNode,
        step:ConvoNodeExecCtxStep,
        stepIndex:number,
        exeCtx:ConvoNodeExecCtx
    ):Promise<ConvoFnCallInfo|undefined>{

        if(this.hasListeners){
            this.triggerEvent({
                type:'execute-step',
                text:`Executing step ${stepIndex}`,
                traverser:tv,
                step:step.nodeStep,
                stepIndex,
                node,
            });
        }

        const call=await this.callTargetAsync(step.nodeStep.name??`Step ${stepIndex}`,tv,step.convo);
        if(call){
            tv.payload=call.returnValue;
            exeCtx.defaultVars['input']=tv.payload;
            const stepKey=stepIndex===-1?'stepAuto':`step${stepIndex}`;
            exeCtx.defaultVars[stepKey]=tv.payload;
        }
        return call;
    }

    private async callTargetAsync(name:string,tv:ConvoTraverser,convo:Conversation):Promise<ConvoFnCallInfo|undefined>
    {
        const call=(await convo.completeAsync({returnOnCalled:true})).lastFnCall;

        if(this.hasListeners){
            this.triggerEvent({
                type:'convo-result',
                text:convo.convo,
                traverser:tv,
            });
        }
        if(!call){
            tv.exeState='failed';
            tv.errorMessage=`${name} function not called`;
            return undefined;
        }

        const isSuccess=call?.message.tags?.some(t=>t.name===convoTags.output);
        const isError=call?.message.tags?.some(t=>t.name===convoTags.errorCallback);

        if(call && (isSuccess || isError)){
            if(isError){
                tv.exeState='failed';
                tv.errorMessage=(
                    `${name} failed. Error callback called.`+
                    ((typeof call.returnValue === 'string')?' '+call.returnValue:'')
                );
                return undefined;
            }
            return call;
        }else{
            tv.exeState='failed';
            tv.errorMessage=`${name} failed. function not called`;
            return undefined;
        }
    }


}
