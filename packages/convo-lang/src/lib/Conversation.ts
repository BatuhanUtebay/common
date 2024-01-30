import { ReadonlySubject, aryRemoveItem, asArray, delayAsync, parseMarkdown, pushBehaviorSubjectAryMany, removeBehaviorSubjectAryValue, removeBehaviorSubjectAryValueMany, safeParseNumber, shortUuid } from "@iyio/common";
import { BehaviorSubject, Observable, Subject } from "rxjs";
import { ZodType, ZodTypeAny, z } from "zod";
import { ConvoError } from "./ConvoError";
import { ConvoExecutionContext } from "./ConvoExecutionContext";
import { containsConvoTag, convoDescriptionToComment, convoDisableAutoCompleteName, convoFunctions, convoLabeledScopeParamsToObj, convoResultReturnName, convoStringToComment, convoTagMapToCode, convoTags, convoTagsToMap, convoTaskTriggers, convoUsageTokensToString, convoVars, defaultConvoPrintFunction, defaultConvoTask, defaultConvoVisionSystemMessage, escapeConvoMessageContent, formatConvoMessage, getConvoDateString, getConvoTag, parseConvoJsonMessage, parseConvoMessageTemplate, spreadConvoArgs, validateConvoFunctionName, validateConvoTypeName, validateConvoVarName } from "./convo-lib";
import { parseConvoCode } from "./convo-parser";
import { CloneConversationOptions, ConvoAppend, ConvoCapability, ConvoCompletion, ConvoCompletionMessage, ConvoCompletionOptions, ConvoCompletionService, ConvoDefItem, ConvoFlatCompletionCallback, ConvoFunction, ConvoFunctionDef, ConvoMarkdownLine, ConvoMessage, ConvoMessageAndOptStatement, ConvoMessagePart, ConvoMessagePrefixOptions, ConvoMessageTemplate, ConvoParsingResult, ConvoPrintFunction, ConvoScopeFunction, ConvoStatement, ConvoSubTask, ConvoTypeDef, ConvoVarDef, FlatConvoConversation, FlatConvoMessage, FlattenConvoOptions, convoObjFlag, isConvoCapability } from "./convo-types";
import { convoTypeToJsonScheme, schemeToConvoTypeString, zodSchemeToConvoTypeString } from "./convo-zod";
import { convoCompletionService } from "./convo.deps";
import { createConvoVisionFunction } from "./createConvoVisionFunction";

export interface ConversationOptions
{
    userRoles?:string[];
    roleMap?:Record<string,string>;
    completionService?:ConvoCompletionService;
    serviceCapabilities?:ConvoCapability[];
    capabilities?:ConvoCapability[];
    maxAutoCompleteDepth?:number;
    /**
     * If true time tags will be added to appended user message
     */
    trackTime?:boolean;

    /**
     * If true tokenUsage tags will be added to completed messages
     */
    trackTokens?:boolean;


    /**
     * If true model tags will be added to completed messages
     */
    trackModel?:boolean;

    /**
     * If true the conversation will not automatically be flattened when new message are appended.
     */
    disableAutoFlatten?:boolean;

    /**
     * Number of milliseconds to delay before flattening the conversation. The delay is used to
     * debounce appends.
     */
    autoFlattenDelayMs?:number;

    /**
     * A function that will be used to output debug values. By default debug information is written
     * to the output of the conversation as comments
     */
    debug?:(...values:any[])=>void;

    debugMode?:boolean;

    /**
     * If true all text based messages will be parsed as markdown and the lines of the markdown will
     * be used to set vars.
     */
    setMarkdownVars?:boolean;

    /**
     * If true all text based message will be parsed as markdown
     */
    parseMarkdown?:boolean;
}

export class Conversation
{
    private _convo:string[]=[];
    public get convo(){return this._convo.join('\n\n')}
    public getConvoStrings(){
        return [...this._convo];
    }

    private _messages:ConvoMessage[]=[];
    public get messages(){return this._messages}

    private readonly _onAppend=new Subject<ConvoAppend>();
    public get onAppend():Observable<ConvoAppend>{return this._onAppend}

    private readonly _activeTaskCount:BehaviorSubject<number>=new BehaviorSubject<number>(0);
    public get activeTaskCountSubject():ReadonlySubject<number>{return this._activeTaskCount}
    public get activeTaskCount(){return this._activeTaskCount.value}

    private readonly _trackTime:BehaviorSubject<boolean>;
    public get trackTimeSubject():ReadonlySubject<boolean>{return this._trackTime}
    public get trackTime(){return this._trackTime.value}
    public set trackTime(value:boolean){
        if(value==this._trackTime.value){
            return;
        }
        this._trackTime.next(value);
    }

    private readonly _trackTokens:BehaviorSubject<boolean>;
    public get trackTokensSubject():ReadonlySubject<boolean>{return this._trackTokens}
    public get trackTokens(){return this._trackTokens.value}
    public set trackTokens(value:boolean){
        if(value==this._trackTokens.value){
            return;
        }
        this._trackTokens.next(value);
    }

    private readonly _trackModel:BehaviorSubject<boolean>;
    public get trackModelSubject():ReadonlySubject<boolean>{return this._trackModel}
    public get trackModel(){return this._trackModel.value}
    public set trackModel(value:boolean){
        if(value==this._trackModel.value){
            return;
        }
        this._trackModel.next(value);
    }

    private readonly _debugMode:BehaviorSubject<boolean>=new BehaviorSubject<boolean>(false);
    public get debugModeSubject():ReadonlySubject<boolean>{return this._debugMode}
    public get debugMode(){return this._debugMode.value}
    public set debugMode(value:boolean){
        if(value==this._debugMode.value){
            return;
        }
        this._debugMode.next(value);
    }

    private readonly _flat:BehaviorSubject<FlatConvoConversation|null>=new BehaviorSubject<FlatConvoConversation|null>(null);
    public get flatSubject():ReadonlySubject<FlatConvoConversation|null>{return this._flat}
    public get flat(){return this._flat.value}


    private readonly _subTasks:BehaviorSubject<ConvoSubTask[]>=new BehaviorSubject<ConvoSubTask[]>([]);
    public get subTasksSubject():ReadonlySubject<ConvoSubTask[]>{return this._subTasks}
    public get subTasks(){return this._subTasks.value}



    /**
     * Unregistered variables will be available during execution but will not be added to the code
     * of the conversation. For example the __cwd var is often used to set the current working
     * directory but is not added to the conversation code.
     */
    public readonly unregisteredVars:Record<string,any>={};

    public userRoles:string[];
    public roleMap:Record<string,string>

    private completionService?:ConvoCompletionService;

    public maxAutoCompleteDepth:number;

    public readonly externFunctions:Record<string,ConvoScopeFunction>={};

    /**
     * Capabilities the conversation should support.
     */
    public readonly capabilities:ConvoCapability[];

    /**
     * Capabilities that should be enabled by the underlying completion service.
     */
    public readonly serviceCapabilities:ConvoCapability[];

    private readonly disableAutoFlatten:boolean;

    private readonly autoFlattenDelayMs:number;

    public dynamicFunctionCallback:ConvoScopeFunction|undefined;


    /**
     * A function that will be used to output debug values. By default debug information is written
     * to the output of the conversation as comments
     */
    debug?:(...values:any[])=>void;

    public print:ConvoPrintFunction=defaultConvoPrintFunction;

    private readonly defaultOptions:ConversationOptions;

    public constructor(options:ConversationOptions={}){
        const {
            userRoles=['user'],
            roleMap={},
            completionService=convoCompletionService.get(),
            capabilities=[],
            serviceCapabilities=[],
            maxAutoCompleteDepth=10,
            trackTime=false,
            trackTokens=false,
            trackModel=false,
            disableAutoFlatten=false,
            autoFlattenDelayMs=30,
            debug,
            debugMode,
        }=options;
        this.defaultOptions=options;
        this.userRoles=userRoles;
        this.roleMap=roleMap;
        this.completionService=completionService;
        this.capabilities=[...capabilities];
        this.serviceCapabilities=serviceCapabilities;
        this.maxAutoCompleteDepth=maxAutoCompleteDepth;
        this._trackTime=new BehaviorSubject<boolean>(trackTime);
        this._trackTokens=new BehaviorSubject<boolean>(trackTokens);
        this._trackModel=new BehaviorSubject<boolean>(trackModel);
        this.disableAutoFlatten=disableAutoFlatten;
        this.autoFlattenDelayMs=autoFlattenDelayMs;
        this.debug=debug;
        if(debugMode){
            this.debugMode=true;
        }
    }

    private runtimeInited=false;
    /**
     * Initializes runtime features and capabilities. initRuntime is called just before the first
     * completion.
     */
    private initRuntime(){
        if(this.runtimeInited){
            return;
        }
        const msg=this.messages.find(f=>!f.fn || f.fn.topLevel)
        if(!msg){
            return;
        }
        this.runtimeInited=true;

        if(msg.tags){
            for(const tag of msg.tags){
                switch(tag.name){

                    case convoTags.capability:
                        if(tag.value){
                            const caps=tag.value.split(',');
                            for(const c of caps){
                                const cap=c.trim();
                                if(isConvoCapability(cap) && !this.capabilities.includes(cap)){
                                    this.capabilities.push(cap);
                                }
                            }
                        }
                        break;

                    case convoTags.enableVision:
                        if(!this.capabilities.includes('vision')){
                            this.capabilities.push('vision');
                        }

                }
            }
        }

        for(const cap of this.capabilities){
            this.enableCapability(cap);
        }

    }

    private _isDisposed=false;
    public get isDisposed(){return this._isDisposed}
    public dispose()
    {
        if(this._isDisposed){
            return;
        }
        this.autoFlattenId++;
        this._isDisposed=true;
    }

    private _defaultApiKey:string|null=null;
    public setDefaultApiKey(key:string|null){
        this._defaultApiKey=key;
    }
    public getDefaultApiKey(){return this._defaultApiKey}



    private parseCode(code:string):ConvoParsingResult{
        return parseConvoCode(code,{parseMarkdown:this.defaultOptions.parseMarkdown})
    }

    private readonly enabledCapabilities:ConvoCapability[]=[];
    public enableCapability(cap:ConvoCapability)
    {
        if(this.enabledCapabilities.includes(cap)){
            return;
        }
        this.enabledCapabilities.push(cap);
        if(!this.capabilities.includes(cap)){
            this.capabilities.push(cap);
        }
        switch(cap){
            case 'vision':
                this.define({
                    hidden:true,
                    fn:createConvoVisionFunction()
                },true)
                break;
        }
    }

    public autoUpdateCompletionService()
    {
        if(!this.completionService){
            this.completionService=convoCompletionService.get();
        }
    }

    public createChild(options?:ConversationOptions)
    {
        const convo=new Conversation({
            ...this.defaultOptions,
            debug:this.debugToConversation,
            debugMode:this.shouldDebug(),
            ...options
        });

        if(this._defaultApiKey){
            convo.setDefaultApiKey(this._defaultApiKey);
        }

        return convo;
    }

    /**
     * Creates a new Conversation and appends the messages of this conversation to the newly
     * created conversation.
     */
    public clone(options?: CloneConversationOptions):Conversation{
        const conversation=new Conversation(this.defaultOptions);
        let messages=this.messages;
        if (options?.noFunctions) {
            messages=messages.filter(m=>!m.fn || m.fn.topLevel);
        }
        if (options?.systemOnly) {
            messages=messages.filter(m=>m.role === 'system' || m.fn?.topLevel || m.fn?.name===convoFunctions.getState);
        }
        conversation.appendMessageObject(messages);
        for(const e in this.externFunctions){
            const f=this.externFunctions[e];
            if(f){
                conversation.externFunctions[e]=f;
            }
        }
        return conversation;
    }

    /**
     * Creates a new Conversation and appends the system messages of this conversation to the newly
     * created conversation.
     */
    public cloneSystem():Conversation{
        return this.clone({systemOnly:true});
    }

    /**
     * Creates a new Conversation and appends the non-function messages of this conversation to the newly
     * created conversation.
     */
    public cloneWithNoFunctions():Conversation{
        return this.clone({noFunctions:true});
    }

    /**
     * Appends new messages to the conversation without appending to the code of the conversation.
     * It is not recommended to use this function with on-going conversation, but only with
     * utility purposes
     */
    public appendMessageObject(message:ConvoMessage|ConvoMessage[]):void{
        const messages=asArray(message);
        this._messages.push(...messages);

        this._onAppend.next({
            text:'',
            messages,
        });

        if(!this.disableAutoFlatten){
            this.autoFlattenAsync();
        }
    }

    public append(messages:string|(ConvoMessagePart|string)[],mergeWithPrev=false,throwOnError=true):ConvoParsingResult{
        let visibleContent:string|undefined=undefined;
        let hasHidden=false;
        if(Array.isArray(messages)){
            hasHidden=messages.some(m=>(typeof m === 'object')?m.hidden:false);
            if(hasHidden){
                visibleContent=messages.filter(m=>(typeof m === 'string')||!m.hidden).map(m=>(typeof m === 'string')?m:m.content).join('');
                messages=messages.map(m=>(typeof m === 'string')?m:m.content).join('');
            }else{
                messages=messages.map(m=>(typeof m === 'string')?m:m.content).join('');
            }
        }
        const r=this.parseCode(messages);
        if(r.error){
            if(!throwOnError){
                return r;
            }
            throw r.error
        }

        if(hasHidden){
            messages=visibleContent??'';
        }

        if(messages){
            if(mergeWithPrev && this._convo.length){
                this._convo[this._convo.length-1]+='\n'+messages;
            }else{
                this._convo.push(messages);
            }
        }

        if(r.result){
            for(const m of r.result){
                this._messages.push(m);
            }
        }

        this._onAppend.next({
            text:messages,
            messages:r.result??[]
        });

        if(!this.disableAutoFlatten){
            this.autoFlattenAsync();
        }

        return r;
    }

    private autoFlattenId=0;
    private async autoFlattenAsync(){
        const id=++this.autoFlattenId;
        if(this.autoFlattenDelayMs>0){
            await delayAsync(this.autoFlattenDelayMs);
            if(this.isDisposed || id!==this.autoFlattenId){
                return;
            }
        }

        const flat=await this.flattenAsync(undefined,{setCurrent:false});
        if(this.isDisposed || id!==this.autoFlattenId){
            return;
        }
        this.setFlat(flat,false);
    }

    public appendUserMessage(message:string,options?:ConvoMessagePrefixOptions){
        this.append(formatConvoMessage('user',message,this.getPrefixTags(options)));
    }

    public appendAssistantMessage(message:string,options?:ConvoMessagePrefixOptions){
        this.append(formatConvoMessage('assistant',message,this.getPrefixTags(options)));
    }

    public appendMessage(role:string,message:string,options?:ConvoMessagePrefixOptions){
        this.append(formatConvoMessage(role,message,this.getPrefixTags(options)));
    }

    public appendDefine(defineCode:string,description?:string):ConvoParsingResult{
        return this.append((description?convoDescriptionToComment(description)+'\n':'')+'> define\n'+defineCode);
    }

    public appendTopLevel(defineCode:string,description?:string):ConvoParsingResult{
        return this.append((description?convoDescriptionToComment(description)+'\n':'')+'> do\n'+defineCode);
    }

    public getVar(nameOrPath:string,defaultValue?:any):any{
        return this._flat.value?.exe?.getVar(nameOrPath,null,defaultValue);
    }

    private getPrefixTags(options?:ConvoMessagePrefixOptions){
        let tags='';
        const msg=options?.msg;
        if(this.trackTime || this.getVar(convoVars.__trackTime)){
            tags+=`@${convoTags.time} ${getConvoDateString()}\n`;
        }
        if(!msg){
            return tags;
        }
        if(options?.includeTokenUsage && (this.trackTokens || this.getVar(convoVars.__trackTokenUsage))){
            tags+=`@${convoTags.tokenUsage} ${convoUsageTokensToString(msg)}\n`;
        }
        if(msg.model && (this.trackModel || this.getVar(convoVars.__trackModel))){
            tags+=`@${convoTags.model} ${msg.model}\n`;
        }
        if(msg.endpoint){
            tags+=`@${convoTags.endpoint} ${msg.endpoint}\n`
        }
        if(msg.format){
            tags+=`@${convoTags.format} ${msg.format}\n`
        }
        if(msg.assignTo){
            tags+=`@${convoTags.assign} ${msg.assignTo}\n`
        }
        return tags;
    }

    private setFlat(flat:FlatConvoConversation,dup=true){
        if(this.isDisposed){
            return;
        }
        this.autoFlattenId++;
        this._flat.next(dup?{...flat}:flat);
    }

    public async callFunctionAsync(
        fn:ConvoFunction|string,
        args:Record<string,any>={},
        options?:ConvoCompletionOptions
    ):Promise<any>{
        const c=await this.tryCompleteAsync(options?.task,options,flat=>{

            if(typeof fn === 'object'){
                flat.exe.loadFunctions([{
                    fn,
                    role:'function'
                }])
            }

            return [{
                callFn:typeof fn==='string'?fn:fn.name,
                callParams:args

            }]
        })

        return c.returnValues?.[0];
    }

    public appendFunctionCall(
        functionName:string,
        args?:Record<string,any>
    ){
        this.append(`@${convoTags.toolId} call_${shortUuid()}\n> call ${functionName}(${
            args===undefined?'':spreadConvoArgs(args,true)
        })`)
    }

    public completeWithFunctionCallAsync(
        name:string,
        args?:Record<string,any>,
        options?:ConvoCompletionOptions
    ):Promise<ConvoCompletion>{
        this.appendFunctionCall(name,args);
        return this.completeAsync(options);
    }

    /**
     * Appends a user message then competes the conversation
     * @param append Optional message to append before submitting
     */
    public completeUserMessageAsync(userMessage:string):Promise<ConvoCompletion>{
        this.appendUserMessage(userMessage);
        return this.completeAsync();
    }

    /**
     * Submits the current conversation and optionally appends messages to the conversation before
     * submitting.
     * @param append Optional message to append before submitting
     */
    public async completeAsync(appendOrOptions?:string|ConvoCompletionOptions):Promise<ConvoCompletion>{
        if(typeof appendOrOptions === 'string'){
            this.append(appendOrOptions);
            appendOrOptions=undefined;
        }

        if(appendOrOptions?.append){
            this.append(appendOrOptions.append);
        }

        const completionService=this.completionService;

        return await this.tryCompleteAsync(
            appendOrOptions?.task,
            appendOrOptions,
            flat=>completionService?.completeConvoAsync(flat)??[]
        )
    }

    /**
     * Completes the conversation and returns the last message as JSON. It is recommended using
     * `@json` mode with the last message that is appended.
     */
    public async completeJsonAsync(appendOrOptions?:string|ConvoCompletionOptions):Promise<any>{
        const r=await this.completeAsync(appendOrOptions);
        if(r.message?.content===undefined){
            return undefined;
        }
        try{
            return parseConvoJsonMessage(r.message.content);
        }catch{
            return undefined;
        }
    }

    /**
     * Completes the conversation and returns the last message as JSON. It is recommended using
     * `@json` mode with the last message that is appended.
     */
    public async completeJsonSchemeAsync<Z extends ZodTypeAny=ZodType<any>, T=z.infer<Z>>(
        params:Z,
        userMessage:string
    ):Promise<T|undefined>{
        const r=await this.completeAsync(/*convo*/`
            > define
            JsonScheme=${zodSchemeToConvoTypeString(params)}

            @json JsonScheme
            > user
            ${escapeConvoMessageContent(userMessage)}
        `);
        if(r.message?.content===undefined){
            return undefined;
        }
        try{
            return parseConvoJsonMessage(r.message.content);
        }catch{
            return undefined;
        }
    }

    /**
     * Completes the conversation and returns the last message call params. The last message of the
     * conversation should instruct the LLM to call a function.
     */
    public async callStubFunctionAsync(appendOrOptions?:string|ConvoCompletionOptions):Promise<any>{
        if(appendOrOptions === undefined){
            appendOrOptions={};
        }else if(typeof appendOrOptions === 'string'){
            appendOrOptions={append:appendOrOptions};
        }
        appendOrOptions.returnOnCall=true;
        const r=await this.completeAsync(appendOrOptions);
        return r.message?.callParams;
    }

    private async tryCompleteAsync(
        task:string|undefined,
        additionalOptions:ConvoCompletionOptions|undefined,
        getCompletion:ConvoFlatCompletionCallback,
        autoCompleteDepth=0,
        prevCompletion?:ConvoCompletionMessage[],
        preReturnValues?:any[],
    ):Promise<ConvoCompletion>{

        if(this._isCompleting.value){
            return {
                status:'busy',
                messages:[],
                task:task??defaultConvoTask,
            }
        }else{
            this._isCompleting.next(true);
            try{
                return await this._completeAsync(task,additionalOptions,getCompletion,autoCompleteDepth,prevCompletion,preReturnValues);
            }finally{
                this._isCompleting.next(false);
            }
        }
    }

    private readonly _isCompleting:BehaviorSubject<boolean>=new BehaviorSubject<boolean>(false);
    public get isCompletingSubject():ReadonlySubject<boolean>{return this._isCompleting}
    public get isCompleting(){return this._isCompleting.value}

    private async _completeAsync(
        task:string|undefined,
        additionalOptions:ConvoCompletionOptions|undefined,
        getCompletion:ConvoFlatCompletionCallback,
        autoCompleteDepth:number,
        prevCompletion?:ConvoCompletionMessage[],
        preReturnValues?:any[],
        templates?:ConvoMessageTemplate[]
    ):Promise<ConvoCompletion>{

        if(task===undefined){
            task=defaultConvoTask;
        }
        const isDefaultTask=task===defaultConvoTask;

        if(!this.runtimeInited){
            this.initRuntime();
        }

        this._activeTaskCount.next(this.activeTaskCount+1);

        try{
            const append:string[]=[];
            const flatExe=this.createConvoExecutionContext(append);
            const flat=await this.flattenAsync(flatExe,{
                setCurrent:false,
                task,
                discardTemplates:!isDefaultTask || templates!==undefined
            });
            if(flat.templates && !templates){
                templates=flat.templates;
            }
            const exe=flat.exe;
            if(this._isDisposed){
                return {messages:[],status:'disposed',task}
            }

            for(const e in this.unregisteredVars){
                flat.exe.setVar(false,this.unregisteredVars[e],e);
            }

            if(isDefaultTask){
                this.setFlat(flat);
            }

            const lastMsg=this.messages[this.messages.length-1];
            const lastMsgIsFnCall=lastMsg?.fn?.call?true:false;
            const completion:ConvoCompletionMessage[]=(lastMsg?.fn?.call?
                [{
                    callFn:lastMsg.fn.name,
                    callParams:exe.getConvoFunctionArgsValue(lastMsg.fn),
                    tags:{toolId:getConvoTag(lastMsg.tags,convoTags.toolId)?.value??''}
                }]:
                await getCompletion(flat)
            );

            if(this._isDisposed){
                return {messages:[],status:'disposed',task};
            }

            let cMsg:ConvoCompletionMessage|undefined=undefined;

            let returnValues:any[]|undefined=undefined;

            let lastResultValue:any=undefined;

            for(const msg of completion){

                let includeTokenUsage=(msg.inputTokens || msg.outputTokens)?true:false;

                const tagsCode=msg.tags?convoTagMapToCode(msg.tags,'\n'):'';

                if(msg.format==='json' && msg.content){
                    let json=parseConvoJsonMessage(msg.content);
                    if(msg.formatIsArray && !Array.isArray(json) && Array.isArray(json.values)){
                        json=json.values;
                    }
                    msg.content=JSON.stringify(json,null,4)
                }

                if(msg.content){
                    cMsg=msg;
                    if(isDefaultTask){
                        this.append(`${this.getPrefixTags({includeTokenUsage,msg})}${tagsCode}> ${this.getReversedMappedRole(msg.role)}\n${escapeConvoMessageContent(msg.content)}\n`);
                    }
                    includeTokenUsage=false;
                }

                if(additionalOptions?.returnOnCall && msg.callFn){
                    cMsg = msg;
                }else if(msg.callFn){
                    let callMessage:ConvoMessage|undefined;
                    if(lastMsgIsFnCall){
                        callMessage=lastMsg;
                        if(!callMessage){
                            throw new Error('Call last message failed')
                        }
                    }else{
                        const callMsg=`${
                            this.getPrefixTags({includeTokenUsage,msg})
                        }${
                            tagsCode
                        }> call ${
                            msg.callFn
                        }(${
                            msg.callParams===undefined?'':spreadConvoArgs(msg.callParams,true)
                        })`
                        const result=isDefaultTask?this.append(callMsg):this.parseCode(callMsg);
                        includeTokenUsage=false;
                        callMessage=result.result?.[0];
                        if(result.result?.length!==1 || !callMessage){
                            throw new ConvoError(
                                'function-call-parse-count',
                                {completion:msg},
                                'failed to parse function call. Exactly 1 function call should have been parsed'
                            );
                        }
                    }
                    exe.clearSharedSetters();
                    if(!callMessage.fn?.call){
                        continue;
                    }
                    const callResult=await exe.executeFunctionResultAsync(callMessage.fn);
                    if(this._isDisposed){
                        return {messages:[],status:'disposed',task}
                    }
                    const callResultValue=callResult.valuePromise?(await callResult.valuePromise):callResult.value;
                    const target=this._messages.find(m=>m.fn && !m.fn.call && m.fn?.name===callMessage?.fn?.name);
                    const disableAutoComplete=(
                        !isDefaultTask ||
                        exe.getVarEx(convoDisableAutoCompleteName,undefined,callResult.scope,false)===true ||
                        containsConvoTag(target?.tags,convoTags.disableAutoComplete)
                    )
                    if(!returnValues){
                        returnValues=[];
                    }
                    returnValues.push(callResultValue);

                    lastResultValue=(typeof callResultValue === 'function')?undefined:callResultValue;

                    const lines:string[]=[`${this.getPrefixTags()}> result`];
                    if(exe.sharedSetters){
                        for(const s of exe.sharedSetters){
                            lines.push(`${s}=${JSON.stringify(exe.sharedVars[s],null,4)}`)
                        }
                    }
                    if( (typeof lastResultValue === 'string') &&
                        lastResultValue.length>50 &&
                        lastResultValue.includes('\n') &&
                        !lastResultValue.includes('---')
                    ){
                        lines.push(`${convoResultReturnName}=---\n${lastResultValue}\n---`)
                    }else{
                        lines.push(`${convoResultReturnName}=${JSON.stringify(lastResultValue,null,4)}`)
                    }
                    lines.push('');
                    if(isDefaultTask){
                        this.append(lines.join('\n'),true);
                    }

                    if(disableAutoComplete){
                        lastResultValue=undefined;
                    }

                    if(isDefaultTask){
                        this.setFlat(flat);
                    }

                }

                if(includeTokenUsage && isDefaultTask){
                    this.append(`${this.getPrefixTags({includeTokenUsage,msg})}> define\n// token usage placeholder`);
                    includeTokenUsage=false;
                }

            }

            if(prevCompletion){
                completion.unshift(...prevCompletion);
            }
            if(preReturnValues){
                if(returnValues){
                    returnValues.unshift(...preReturnValues);
                }else{
                    returnValues=preReturnValues;
                }
            }

            if(append.length){
                if(isDefaultTask){
                    for(const a of (append as string[])){
                        this.append(a);
                    }
                }
            }else if(lastResultValue!==undefined && autoCompleteDepth<this.maxAutoCompleteDepth){
                return await this._completeAsync(task,additionalOptions,getCompletion,autoCompleteDepth+1,completion,returnValues,templates);
            }

            if(isDefaultTask && templates?.length){
                this.writeTemplates(templates,flat);
            }

            if(!this.disableAutoFlatten && isDefaultTask){
                this.autoFlattenAsync();
            }


            if(flat.taskTriggers?.[convoTaskTriggers.onResponse]){
                this.startSubTasks(flat,convoTaskTriggers.onResponse,getCompletion,autoCompleteDepth+1,additionalOptions);
            }

            return {
                status:'complete',
                message:cMsg,
                messages:completion,
                exe,
                returnValues,
                task
            }
        }finally{
            this._activeTaskCount.next(this.activeTaskCount-1);
        }
    }

    private writeTemplates(
        templates:ConvoMessageTemplate[],
        flat:FlatConvoConversation
    ){
        for(let i=0;i<templates.length;i++){
            const tmpl=templates[i];
            if(!tmpl?.watchPath || !tmpl.message.statement?.source){continue}

            const value=flat.exe.getVar(tmpl.watchPath);
            if( value!==tmpl.startValue &&
                (tmpl.matchValue===undefined?
                    true:
                    (value?.toString()??'')===tmpl.matchValue
                )
            ){

                const tags:string[]=[];
                if(tmpl.message.tags){
                    for(let t=0;t<tmpl.message.tags.length;t++){
                        const tag=tmpl.message.tags[t];
                        if(!tag || tag.name===convoTags.template){continue}
                        tags.push(`@${tag.name}${tag.value?' '+tag.value:''}\n`)

                    }
                }

                const tmplMsg=`@${convoTags.sourceTemplate}${
                    tmpl.name?' '+tmpl.name:''
                }\n${
                    tags.join('')
                }${
                    tmpl.message.statement.source
                }`;

                this.append(tmplMsg);
            }

        }
    }

    private startSubTasks(
        flat:FlatConvoConversation,
        trigger:string,
        getCompletion:ConvoFlatCompletionCallback,
        autoCompleteDepth:number,
        additionalOptions:ConvoCompletionOptions|undefined)
    {
        const tasks=flat.taskTriggers?.[trigger];
        if(!tasks?.length){
            return;
        }

        let added=false;
        const remove:ConvoSubTask[]=[];

        const subs=tasks.map<ConvoSubTask>(task=>{
            const promise=this._completeAsync(task,additionalOptions,getCompletion,autoCompleteDepth);
            const sub:ConvoSubTask={
                name:task,
                promise
            }

            promise.then(()=>{
                if(added){
                    removeBehaviorSubjectAryValue(this._subTasks,sub);
                }else{
                    remove.push(sub);
                }
            })

            return sub;
        });

        pushBehaviorSubjectAryMany(this._subTasks,subs);
        added=true;
        if(remove.length){
            removeBehaviorSubjectAryValueMany(this._subTasks,remove);
        }
    }


    public getReversedMappedRole(role:string|null|undefined):string{
        if(!role){
            return 'user';
        }
        for(const e in this.roleMap){
            if(this.roleMap[e]===role){
                return e;
            }
        }
        return role;
    }

    public getMappedRole(role:string|null|undefined):string{
        if(!role){
            return 'user';
        }
        return this.roleMap[role]??role;
    }

    public createConvoExecutionContext(append:string[]=[]):ConvoExecutionContext{
        const flatExe=new ConvoExecutionContext({
            conversation:this,
            convoPipeSink:(value)=>{
                if(!(typeof value === 'string')){
                    value=value?.toString();
                    if(!value?.trim()){
                        return value;
                    }
                }
                append.push(value);
                return value;
            }
        })
        flatExe.print=this.print;
        return flatExe;
    }

    public async flattenAsync(
        exe:ConvoExecutionContext=this.createConvoExecutionContext(),
        {
            task=defaultConvoTask,
            setCurrent=task===defaultConvoTask,
            discardTemplates,
        }:FlattenConvoOptions={}
    ):Promise<FlatConvoConversation>{

        const isDefaultTask=task===defaultConvoTask;

        const messages:FlatConvoMessage[]=[];
        const edgePairs:{
            flat:FlatConvoMessage;
            msg:ConvoMessage;
            shouldParseMd:boolean;
            setMdVars:boolean;
        }[]=[];
        const mdVarCtx:MdVarCtx={
            indexMap:{},
            vars:{},
            varCount:0,
        };
        exe.setVar(true,mdVarCtx.vars,convoVars.__md);

        exe.loadFunctions(this._messages,this.externFunctions);
        let hasNonDefaultTasks=false;
        let maxTaskMsgCount=-1;
        let taskTriggers:Record<string,string[]>|undefined;
        let templates:ConvoMessageTemplate[]|undefined;

        for(let i=0;i<this._messages.length;i++){
            const msg=this._messages[i];
            if(!msg || (msg.role==='user' && !msg.content && !msg.statement)){
                continue;
            }

            const template=getConvoTag(msg.tags,convoTags.template)?.value;
            if(template){
                if(discardTemplates){
                    continue;
                }
                const tmpl=parseConvoMessageTemplate(msg,template);
                if(!templates){
                    templates=[];
                }
                templates.push(tmpl);
                continue;
            }

            const flat:FlatConvoMessage={
                role:this.getMappedRole(msg.role),
                tags:msg.tags?convoTagsToMap(msg.tags):undefined,
            }

            if(msg.component!==undefined){
                flat.component=msg.component;
            }
            if(msg.renderOnly){
                flat.renderOnly=true;
            }
            if(msg.markdown){
                flat.markdown=msg.markdown;
            }
            const setMdVars=(
                this.defaultOptions.setMarkdownVars ||
                containsConvoTag(msg.tags,convoTags.markdownVars)
            );
            const shouldParseMd=(
                setMdVars ||
                this.defaultOptions.parseMarkdown ||
                containsConvoTag(msg.tags,convoTags.markdown)
            )


            const msgTask=getConvoTag(msg.tags,convoTags.task)?.value??defaultConvoTask;
            if(msgTask!==defaultConvoTask){
                hasNonDefaultTasks=true;
                flat.task=msgTask;
                if(isDefaultTask){
                    const trigger=getConvoTag(msg.tags,convoTags.taskTrigger)?.value;
                    if(trigger){
                        if(!taskTriggers){
                            taskTriggers={}
                        }
                        const ary=taskTriggers[trigger]??(taskTriggers[trigger]=[]);
                        if(!ary.includes(msgTask)){
                            ary.push(msgTask);
                        }
                    }
                }
            }
            if(msgTask===task){
                const maxTasks=getConvoTag(msg.tags,convoTags.maxTaskMessageCount)?.value;
                if(maxTasks){
                    maxTaskMsgCount=safeParseNumber(maxTasks,maxTaskMsgCount);
                }
            }
            if(this.userRoles.includes(flat.role)){
                flat.isUser=true;
            }
            if(msg.fn){
                if(msg.fn.local || msg.fn.call){
                    continue;
                }else if(msg.fn.topLevel){
                    exe.clearSharedSetters();
                    const r=exe.executeFunction(msg.fn);
                    if(r.valuePromise){
                        await r.valuePromise;
                    }
                    if(exe.sharedSetters.length){
                        const varSetter:FlatConvoMessage={
                            role:msg.role??'define',
                        };
                        varSetter.setVars={};
                        for(const v of exe.sharedSetters){
                            varSetter.setVars[v]=exe.getVar(v);
                        }
                        messages.push(varSetter)
                    }
                    const prev=this._messages[i-1];
                    if(msg.role==='result' && prev?.fn?.call){
                        flat.role='function';
                        flat.called=prev.fn;
                        flat.calledReturn=exe.getVarEx(convoResultReturnName,undefined,undefined,false);
                        flat.calledParams=exe.getConvoFunctionArgsValue(prev.fn);
                        if(prev.tags){
                            flat.tags=flat.tags?{...convoTagsToMap(prev.tags),...flat.tags}:convoTagsToMap(prev.tags)
                        }
                    }else{
                        continue;
                    }
                }else{
                    flat.role='function';
                    flat.fn=msg.fn;
                    flat.fnParams=exe.getConvoFunctionArgsScheme(msg.fn);
                }
            }else if(msg.statement){
                if(containsConvoTag(msg.tags,convoTags.edge)){
                    flat.edge=true;
                    edgePairs.push({flat,msg:msg,shouldParseMd,setMdVars});
                }else{
                    await flattenMsgAsync(
                        exe,
                        msg.statement,
                        flat,
                        shouldParseMd
                    );
                }

            }else if(msg.content!==undefined){
                flat.content=msg.content;
            }else{
                continue;
            }

            messages.push(flat);

            if(!flat.edge){
                this.applyTagsAndState(msg,flat,messages,exe,setMdVars,mdVarCtx);
            }
        }

        for(const pair of edgePairs){
            if(pair.msg.statement){
                await flattenMsgAsync(exe,pair.msg.statement,pair.flat,pair.shouldParseMd);
            }
            this.applyTagsAndState(pair.msg,pair.flat,messages,exe,pair.setMdVars,mdVarCtx);
        }


        if(this.capabilities.includes('vision') && isDefaultTask){
            const systemMessage=messages.find(m=>m.role==='system');
            const content=exe.getVar(convoVars.__visionServiceSystemMessage,null,defaultConvoVisionSystemMessage);
            if(systemMessage){
                systemMessage.content=(
                    (systemMessage.content?systemMessage.content+'\n\n':'')+
                    content
                )
            }else{
                messages.unshift({
                    role:'system',
                    content
                })
            }
        }


        const shouldDebug=this.shouldDebug(exe);
        const debug=shouldDebug?(this.debug??this.debugToConversation):undefined;
        if(shouldDebug){
            exe.print=(...args:any[])=>{
                debug?.(...args);
                return defaultConvoPrintFunction(...args);
            }
        }

        if(!isDefaultTask || hasNonDefaultTasks){

            if(isDefaultTask){
                for(let i=0;i<messages.length;i++){
                    const msg=messages[i];
                    if((msg?.task??defaultConvoTask)!==defaultConvoTask){
                        messages.splice(i,1);
                        i--;
                    }
                }
            }else{
                const taskMsgs:FlatConvoMessage[]=[];
                let taskHasSystem=false;
                let otherMsgCount=0;

                for(let i=0;i<messages.length;i++){
                    const msg=messages[i];
                    if(!msg){
                        continue;
                    }
                    if(msg.task===task){
                        if(msg.role==='system'){
                            taskHasSystem=true;
                        }
                        taskMsgs.push(msg);
                        messages.splice(i,1);
                        i--;
                    }else if(msg.fn || msg.called){
                        messages.splice(i,1);
                        i--;
                    }else if(msg.role!=='system'){
                        otherMsgCount++;
                    }
                }

                if(taskHasSystem){
                    for(let i=0;i<messages.length;i++){
                        const msg=messages[i];
                        if(msg?.role==='system'){
                            messages.splice(i,1);
                            i--;
                        }
                    }
                }

                if(maxTaskMsgCount!==-1 && otherMsgCount>maxTaskMsgCount){
                    let index=0;
                    while(otherMsgCount>maxTaskMsgCount && index<messages.length){
                        const msg=messages[index];
                        if(!msg || msg.role==='system'){
                            index++;
                            continue;
                        }
                        messages.splice(index,1);
                        otherMsgCount--;
                    }
                }
                for(let i=0;i<taskMsgs.length;i++){
                    const msg=taskMsgs[i];
                    if(msg){
                        messages.push(msg);
                    }
                }
            }
        }

        let capabilities=[...this.serviceCapabilities];
        if(!isDefaultTask){
            capabilities=capabilities.filter(c=>c!=='vision');
        }

        if(templates){
            for(let i=0;i<templates.length;i++){
                const tmpl=templates[i];
                if(!tmpl || !tmpl.watchPath){continue}

                tmpl.startValue=exe.getVar(tmpl.watchPath);
            }
        }

        const flat:FlatConvoConversation={
            exe,
            vars:exe.getUserSharedVars(),
            messages,
            conversation:this,
            task,
            taskTriggers,
            templates,
            debug,
            capabilities,
            markdownVars:mdVarCtx.vars
        }

        if(setCurrent){
            this.setFlat(flat);
        }

        return flat;
    }

    private isTagConditionTrue(exe:ConvoExecutionContext,tagValue:string,startIndex=0):boolean{
        const parts=tagValue.split(/\s+/);
        if(startIndex){
            parts.splice(0,startIndex);
        }
        if(parts.length<1){
            return false;
        }
        const value=exe.getVar(parts[0]??'');
        if(parts.length===1){
            return value?true:false;
        }
        let v2:any;
        if(parts.length>2){
            parts.shift();
            v2=parts.join(' ');
        }else{
            v2=parts[1];
        }
        return value?.toString()===v2;

    }

    private applyTagsAndState(
        msg:ConvoMessage,
        flat:FlatConvoMessage,
        allMessages:FlatConvoMessage[],
        exe:ConvoExecutionContext,
        setMdVars:boolean,
        mdVarCtx:MdVarCtx
    ){
        if(msg.assignTo){
            exe.setVar(true,msg.jsonValue??flat.content,msg.assignTo);
        }

        if(setMdVars && flat.markdown){
            for(const line of flat.markdown){
                const index=mdVarCtx.indexMap[line.type]??0;
                mdVarCtx.indexMap[line.type]=index+1;
                mdVarCtx.varCount++;
                const mdLine:ConvoMarkdownLine={
                    [convoObjFlag]:'md',
                    line
                }
                mdVarCtx.vars[line.type+index]=mdLine;
                const tagName=getConvoTag(line.tags,'name')?.value;
                if(tagName){
                    mdVarCtx.vars[tagName]=mdLine;
                }

                if(line.nodes){
                    for(const node of line.nodes){

                        if(node.imageUrl){
                            const li=mdVarCtx.indexMap['image']??0;
                            mdVarCtx.indexMap['image']=li+1;
                            mdVarCtx.vars['imageUrl'+li]=node.imageUrl;
                            const key=line.type+index;
                            mdVarCtx.vars[key+'ImageUrl'+li]=node.imageUrl;
                            if(tagName){
                                mdVarCtx.vars[tagName+'ImageUrl']=node.imageUrl;
                            }
                            mdVarCtx.vars['imageText'+li]=node.text??'';
                            mdVarCtx.vars[key+'ImageText'+li]=node.text??'';
                            if(tagName){
                                mdVarCtx.vars[tagName+'ImageText']=node.text??'';
                            }
                        }

                        if(node.link && node.url){
                            const li=mdVarCtx.indexMap['link']??0;
                            mdVarCtx.indexMap['link']=li+1;
                            mdVarCtx.vars['linkUrl'+li]=node.url;
                            const key=line.type+index;
                            mdVarCtx.vars[key+'LinkUrl'+li]=node.url;
                            if(tagName){
                                mdVarCtx.vars[tagName+'LinkUrl']=node.url;
                            }
                            mdVarCtx.vars['linkText'+li]=node.text??'';
                            mdVarCtx.vars[key+'LinkText'+li]=node.text??'';
                            if(tagName){
                                mdVarCtx.vars[tagName+'LinkText']=node.text??'';
                            }
                        }

                    }
                }
            }
        }

        let value:any;
        if(flat.isUser){

            value=exe.getVar(convoVars.__model);
            if(value && (typeof value === 'string')){
                flat.responseModel=value;
            }

            value=exe.getVar(convoVars.__endpoint);
            if(value && (typeof value === 'string')){
                flat.responseEndpoint=value;
            }
        }



        if(!msg.tags){
            return;
        }
        let responseFormat:string|undefined;
        for(const tag of msg.tags){
            switch(tag.name){

                case convoTags.responseFormat:
                    responseFormat=tag.value;
                    break;

                case convoTags.json:
                    responseFormat=tag.value?'json '+tag.value:'json';
                    break;

                case convoTags.responseAssign:
                    flat.responseAssignTo=tag.value;
                    break;

                case convoTags.responseModel:
                    flat.responseModel=tag.value;
                    break;

                case convoTags.responseEndpoint:
                    flat.responseEndpoint=tag.value;
                    break;

                case convoTags.condition:
                    if(!tag.value || !this.isTagConditionTrue(exe,tag.value)){
                        aryRemoveItem(allMessages,flat);
                    }
                    break;

            }
        }
        if(responseFormat){
            this.applyResponseFormat(msg,flat,responseFormat,exe);
        }
    }
    private applyResponseFormat(msg:ConvoMessage,flat:FlatConvoMessage,format:string,exe:ConvoExecutionContext)
    {
        if(!flat.content){
            return;
        }

        const parts=format.trim().split(' ');
        flat.responseFormat=parts[0];

        let typeName=parts[1]??'';
        if(!typeName){
            return;
        }
        const isArray=typeName.endsWith('[]')
        if(isArray){
            typeName=typeName.substring(0,typeName.length-2);
        }

        flat.responseFormatTypeName=typeName;
        flat.responseFormatIsArray=isArray;

        if(flat.responseFormat!=='json'){
            return;
        }

        const type=exe.getVar(typeName);

        let scheme=convoTypeToJsonScheme(type);

        if(!scheme){
            throw new ConvoError('invalid-message-response-scheme',{message:msg},`${typeName} does not point to a convo type object `);
        }

        if(isArray){
            scheme={
                type:'object',
                required:['values'],
                properties:{
                    values:{
                        type:'array',
                        items:scheme
                    }
                }
            }
        }

        flat.content+=`\n\nReturn an object that conforms to the JSON Schema below.\n:${
            JSON.stringify(scheme)
        }`;



    }

    public shouldDebug(exe?:ConvoExecutionContext)
    {
        return (
            this.debugMode ||
            (exe?exe.getVar(convoVars.__debug):this.getVar(convoVars.__debug))
        )?true:false;
    }

    public readonly debugToConversation=(...args:any[])=>{
        if(!args.length){
                return;
            }
            const out:string[]=[];
            for(const v of args){
                if(typeof v === 'string'){
                    out.push(v);
                }else{
                    try{
                        out.push(JSON.stringify(v,null,4)??'');
                    }catch{
                        out.push(v?.toString()??'');
                    }
                }
            }
            const debugComment=convoStringToComment(out.join('\n'));
            this.append(`> debug\n${debugComment}`);
    }

    private readonly definitionItems:ConvoDefItem[]=[];

    public define(items:ConvoDefItem|(ConvoDefItem[]),override?:boolean):ConvoParsingResult|undefined
    {

        let original=true;
        if(!Array.isArray(items)){
            original=false;
            items=[items];
        }

        const startLength=items.length;
        for(let i=0;i<startLength;i++){
            const item=items[i];
            if(!item){continue}

            if(item.types){
                if(original){
                    items=[...items];
                    original=false;
                }
                for(const e in item.types){
                    const type=item.types[e];
                    if(type){
                        items.push({type:{name:e,type:type}})
                    }
                }
            }

            if(item.vars){
                if(original){
                    items=[...items];
                    original=false;
                }
                for(const e in item.vars){
                    items.push({var:{name:e,value:item.vars[e]}})
                }
            }

            if(item.fns){
                if(original){
                    items=[...items];
                    original=false;
                }
                for(const e in item.fns){
                    const fn=item.fns[e];
                    if(typeof fn === 'object'){
                        items.push({fn:{name:e,...fn}})
                    }else if(fn){
                        items.push({fn:{
                            name:e,
                            local:true,
                            callback:fn
                        }})
                    }
                }
            }
        }

        const outParts:(string|ConvoMessagePart)[]=[];
        const push=(content:string,item:ConvoDefItem)=>{
            if(item.hidden){
                outParts.push({hidden:true,content});
            }else{
                outParts.push(content);
            }
        }
        for(let i=0;i<items.length;i++){
            const item=items[i];
            if(!item){
                continue;
            }
            const type=item.type;
            if(!type || (!override && this.getAssignment(type.name))){
                continue
            }

            validateConvoTypeName(type.name);

            const str=schemeToConvoTypeString(type.type,type.name);
            if(!str){
                continue;
            }
            push(str,item);
            push('\n',item);
            this.definitionItems.push({type});
        }

        for(let i=0;i<items.length;i++){
            const item=items[i];
            if(!item){
                continue;
            }
            const v=item.var;
            if(!v || (!override && this.getAssignment(v.name))){
                continue
            }

            validateConvoVarName(v.name);

            push(`${v.name} = ${JSON.stringify(v.value,null,4)}`,item);
            push('\n',item);
            this.definitionItems.push({var:v});
        }

        if(outParts.length){
            outParts.unshift('> define\n')
        }

        for(let i=0;i<items.length;i++){
            const item=items[i];
            if(!item){
                continue;
            }
            const fn=items[i]?.fn;
            if(!fn || (!override && !fn.registerOnly && this.getAssignment(fn.name))){
                continue
            }

            validateConvoFunctionName(fn.name);

            if(outParts.length){
                push('\n',item);
            }
            if(fn.registerOnly){
                if(fn.local===false){
                    throw new ConvoError('invalid-register-only-function',undefined,'Register only functions can only be local');
                }
                this.createFunctionImpl(fn);
            }else{
                push(this.createFunctionImpl(fn),item);
                push('\n',item);
            }
        }

        return outParts.length?this.append(outParts):undefined;
    }

    public defineType(type:ConvoTypeDef,override?:boolean):ConvoParsingResult|undefined{
        return this.define([{type}],override);
    }

    public defineTypes(types:ConvoTypeDef[],override?:boolean):ConvoParsingResult|undefined{
        return this.define(types.map(type=>({type})),override);
    }

    public defineVar(variable:ConvoVarDef,override?:boolean):ConvoParsingResult|undefined{
        return this.define([{var:variable}],override);

    }

    public defineVars(vars:ConvoVarDef[],override?:boolean):ConvoParsingResult|undefined{
        return this.define(vars.map(v=>({var:v})),override);
    }

    public defineFunction(fn:ConvoFunctionDef,override?:boolean){
        return this.define([{fn}],override);
    }

    public defineFunctions(fns:ConvoFunctionDef[],override?:boolean){
        return this.define(fns.map(fn=>({fn})),override);
    }

    private createFunctionImpl(fnDef:ConvoFunctionDef):string{
        const params=fnDef.paramsType??fnDef.paramsJsonScheme;
        const fnSig=(
            (fnDef.disableAutoComplete?`@${convoTags.disableAutoComplete}\n`:'')+
            (fnDef.description?convoDescriptionToComment(fnDef.description)+'\n':'')+
            (params?schemeToConvoTypeString(params,`>${fnDef.local?' local':''} `+fnDef.name):`>${fnDef.local?' local':''} ${fnDef.name}()`)
        );

        if(fnDef.returnScheme && !this.definitionItems.some(t=>t.type===fnDef.returnScheme)){
            this.defineType(fnDef.returnScheme);
        }

        if(fnDef.body){
            if(fnDef.registerOnly){
                throw new ConvoError('invalid-register-only-function',undefined,'Register only function are not allowed to define a body')
            }
            const returnType=fnDef.returnScheme?.name??fnDef.returnTypeName;
            return `${fnSig} ->${returnType?' '+returnType:''} (\n${fnDef.body}\n)`;
        }else{
            let scopeFn:ConvoScopeFunction|undefined=undefined;
            if(fnDef.scopeCallback){
                scopeFn=fnDef.scopeCallback;
            }else if(fnDef.callback){
                const callback=fnDef.callback;
                if(fnDef.paramsJsonScheme || fnDef.paramsType){
                    scopeFn=(scope)=>{
                        return callback(convoLabeledScopeParamsToObj(scope));
                    }
                }else{
                    scopeFn=(scope)=>{
                        return callback(scope.paramValues?.[0]);
                    }
                }
            }
            if(scopeFn){
                this.externFunctions[fnDef.name]=scopeFn;
            }
            return fnSig;
        }
    }

    public getAssignment(name:string,excludePreAssigned=false):ConvoMessageAndOptStatement|undefined{
        return (
            this._getAssignment(name,this._messages)??
            (excludePreAssigned?undefined:this._getAssignment(name,this.preAssignMessages))
        )
    }

    private _getAssignment(name:string,messages:ConvoMessage[]):ConvoMessageAndOptStatement|undefined{
        for(let i=messages.length-1;i>-1;i--){
            const message=messages[i];
            if(!message?.fn){continue}

            if(message.fn.topLevel){
                if(!message.fn.body){
                    continue;
                }
                for(let b=0;b<message.fn.body.length;b++){
                    const statement=message.fn.body[b];
                    if(!statement){continue}

                    if(statement.set===name && !statement.setPath){
                        return {message,statement}
                    }
                }
            }else{
                if(!message.fn.call && message.fn.name===name){
                    return {message};
                }
            }
        }
        return undefined;
    }


    private preAssignMessages:ConvoMessage[]=[];
    /**
     * Used to mark variables, types and function as assigned before actually appending the code.
     */
    public preAssign(convoCode:string){
        const r=this.parseCode(convoCode);
        if(r.error){
            throw new Error(r.error.message);
        }
        if(r.result){
            for(const m of r.result){
                this.preAssignMessages.push(m);
            }
        }
    }
}


const flattenMsgAsync=async (
    exe:ConvoExecutionContext,
    statement:ConvoStatement,
    flat:FlatConvoMessage,
    parseMd:boolean
)=>{
    const r=exe.executeStatement(statement);
    let value:any;
    if(r.valuePromise){
        value=await r.valuePromise;
    }else{
        value=r.value;
    }
    if(typeof value === 'string'){
        flat.content=value;
    }else{
        flat.content=value?.toString()??'';
    }
    if(parseMd && !flat.markdown){
        const r=parseMarkdown(flat.content??'',{parseTags:true});
        if(r.result){
            flat.markdown=r.result;
        }
    }
}

interface MdVarCtx
{
    indexMap:Record<string,number>;
    vars:Record<string,ConvoMarkdownLine|string>;
    varCount:number;
}
