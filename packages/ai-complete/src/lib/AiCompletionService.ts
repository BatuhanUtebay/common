import { ProviderTypeDef, Scope, TypeDef, UnauthorizedError, shortUuid, zodTypeToJsonScheme } from "@iyio/common";
import { ConvoCompletionMessage, ConvoCompletionService, FlatConvoConversation } from '@iyio/convo-lang';
import { ZodType, ZodTypeAny, z } from "zod";
import { AiCompletionProviders } from "./_type.ai-complete";
import { CallAiFunctionInterfaceResult, aiCompleteDefaultModel, applyResultToAiMessage, callAiFunctionInterfaceAsync, mergeAiCompletionMessages } from "./ai-complete-lib";
import { AiComplationMessageType, AiCompletionFunction, AiCompletionFunctionInterface, AiCompletionMessage, AiCompletionProvider, AiCompletionRequest, AiCompletionResult, CompletionOptions, isAiCompletionRole } from "./ai-complete-types";
import { parseAiCompletionMessages } from "./ai-message-converter";

export interface AiCompletionServiceOptions
{
    providers:ProviderTypeDef<AiCompletionProvider>;
}

export class AiCompletionService implements ConvoCompletionService
{

    public static fromScope(scope:Scope){
        return new AiCompletionService({
            providers:scope.to(AiCompletionProviders),
        })
    }

    private readonly providers:TypeDef<AiCompletionProvider>;

    public constructor({
        providers
    }:AiCompletionServiceOptions){

        this.providers=providers;
    }

    private getProvider(lastMessage:AiCompletionMessage,request:AiCompletionRequest,options?:CompletionOptions):AiCompletionProvider|undefined{
        return this.providers.getFirst(null,p=>{
            if(p.canComplete?.(lastMessage,request,options)){
                return p;
            }else{
                return undefined;
            }
        }) ?? this.providers.getFirst(null,p=>{
            if(p.canComplete===undefined){
                return p;
            }else{
                return undefined;
            }
        })
    }

    public async completeAsync(requestOrMessages:AiCompletionRequest|string,options?:CompletionOptions):Promise<AiCompletionResult>
    {

        let request:AiCompletionRequest;

        if(typeof requestOrMessages === 'string'){
            const messages=parseAiCompletionMessages(requestOrMessages);
            request={
                messages
            }
        }else{
            request=requestOrMessages;
        }

        request={...request};
        request.messages=[...request.messages];

        let result:AiCompletionResult|null=null;
        let lastMessage:AiCompletionMessage|undefined=request.messages[request.messages.length-1];

        const mergeResult=(r:AiCompletionResult)=>{
            r.options.sort((a,b)=>b.confidence-a.confidence);
            if(result){
                if(!result.preGeneration){
                    result.preGeneration=[];
                }
                const prevOpt=result.options[0];
                if(prevOpt){
                    result.preGeneration.push(prevOpt.message);
                }
                if(r.preGeneration){
                    result.preGeneration.push(...r.preGeneration);
                    mergeAiCompletionMessages(r.preGeneration,request.messages);
                }
                result.options=r.options;
                if(!result.preGeneration.length){
                    delete result.preGeneration;
                }
            }else{
                result=r;
                if(r.preGeneration){
                    mergeAiCompletionMessages(r.preGeneration,request.messages);
                }
            }

            let lm=result.options[0]?.message;
            if(lm){
                request.messages.push(lm);
            }

            lm=request.messages[request.messages.length-1];
            if(lastMessage && lm && lm.id===lastMessage.id){
                lastMessage=undefined;
            }else{
                lastMessage=lm;
            }

        }

        const complete=async (msg:AiCompletionMessage)=>{
            const provider=this.getProvider(msg,request,options);
            if(!provider){
                return false;
            }

            if(msg.model){
                checkModelAccess(msg.model,provider,options);
            }

            try{
                mergeResult(await provider.completeAsync(msg,request,options));
                return true;
            }catch(ex){
                request.debug?.(`Error - ${(ex as any)?.message}`,ex);
                mergeResult({options:[{
                    confidence:1,
                    message:{
                        id:shortUuid(),
                        role:'assistant',
                        type:'error',
                        content:(ex as any)?.message,
                        errorCausedById:msg.id,
                        isError:true,
                    }
                }]})
                return false;
            }
        }

        if(lastMessage?.role==='user' && lastMessage.type==='audio'){
            const success=await complete(lastMessage);
            if(!success){
                return result??{options:[]}
            }
        }

        if(request.preGenerateOnly){
            return result??{options:[]}
        }

        if(lastMessage?.role==='user' || lastMessage?.called){
            const success=await complete(lastMessage);
            if(!success){
                return result??{options:[]}
            }
        }

        return result??{options:[]}
    }

    public async generateImageAsync(prompt:string):Promise<AiCompletionMessage|null>
    {
        const result=await this.completeAsync({messages:[{
            id:shortUuid(),
            role:'user',
            type:'text',
            requestedResponseType:'image',
            content:prompt
        }]})

        const msg=result.options[0]?.message;
        return (msg?.type==='image' && msg.url)?msg:null;
    }

    public async generateFunctionParamsAsync<Z extends ZodTypeAny=ZodType<any>,T=z.infer<Z>>(
        functionName:string,
        description:string,
        params:Z,
        prompt:string|AiCompletionMessage|AiCompletionMessage[],
    ):Promise<T|undefined>{
        if(typeof prompt === 'string'){
            prompt=parseAiCompletionMessages(prompt);
        }else if(!Array.isArray(prompt)){
            prompt=[prompt];
        }

        const fn:AiCompletionFunction={
            name:functionName,
            description,
            params:zodTypeToJsonScheme(params,10),
        }

        const result=await this.completeAsync({
            messages:prompt,
            functions:[fn],
        });

        const msg=result.options[0]?.message;
        if(!msg){
            return undefined;
        }
        if(msg.isError){
            throw new Error(msg.callError?.error??'Call failed');
        }

        if(!msg.call){
            return undefined;
        }

        return params.parse(msg.call.params);
    }

    public async generateFunctionInterfaceParamsAsync<Z extends ZodTypeAny=ZodType<any>,T=z.infer<Z>,C=any,V=any>(
        fi:AiCompletionFunctionInterface<Z,T,C,V>,
        prompt:string|AiCompletionMessage|AiCompletionMessage[],
        descriptionOverride?:string
    ):Promise<T|undefined>{

        return this.generateFunctionParamsAsync(
            fi.name,
            descriptionOverride??fi.description,
            fi.params,
            prompt,
        )
    }

    public async callFunctionInterfaceAsync<Z extends ZodTypeAny=ZodType<any>,T=z.infer<Z>,C=any,V=any>(
        fi:AiCompletionFunctionInterface<Z,T,C,V>,
        prompt:string|AiCompletionMessage|AiCompletionMessage[],
        {
            descriptionOverride,
            applyToMessage,
            render=applyToMessage?true:false,
        }:AiCompletionServiceCallFunctionOptions={}
    ):Promise<CallAiFunctionInterfaceResult<C,V>|undefined>{

        const params=await this.generateFunctionInterfaceParamsAsync(fi,prompt,descriptionOverride);
        if(!params){
            return undefined;
        }

        const callResult=await callAiFunctionInterfaceAsync(fi,render,params,this);
        if(applyToMessage){
            applyResultToAiMessage(applyToMessage,callResult);
        }

        return callResult;
    }

    public getMaxTokensForMessageType(messageType:AiComplationMessageType,model?:string):number{
        return this.providers.getFirst(null,p=>{
            return p.getMaxTokensForMessageType?.(messageType,model);
        })??3000;
    }

    public getTokenEstimateForMessage(message:string,model?:string):number{
        return this.providers.getFirst(null,p=>{
            return p.getTokenEstimateForMessage?.(message,model);
        })??(message.length/2)
    }

    public async completeConvoAsync(flat:FlatConvoConversation):Promise<ConvoCompletionMessage[]>
    {
        const messages:AiCompletionMessage[]=[];
        const functions:AiCompletionFunction[]=[];

        const baseId=shortUuid()+'_';

        for(let i=0;i<flat.messages.length;i++){
            const msg=flat.messages[i];
            if(!msg){
                continue;
            }
            if(msg.fn){

                functions.push({
                    name:msg.fn.name,
                    description:msg.fn.description??'',
                    params:msg.fnParams?zodTypeToJsonScheme(msg.fnParams):undefined
                });

            }else if(msg.called){
                messages.push({
                    id:baseId+i,
                    type:'function',
                    role:'assistant',
                    called:msg.called.name,
                    calledParams:msg.calledParams,
                    calledReturn:msg.calledReturn,
                    metadata:msg.tags,
                })
            }else{
                messages.push({
                    id:baseId+i,
                    type:'text',
                    role:isAiCompletionRole(msg.role)?msg.role:'user',
                    content:msg.content,
                    metadata:msg.tags,
                });
            }
        }

        const result=await this.completeAsync({messages,functions,debug:flat.debug});

        const resultMessage=result.options[0];
        if(!resultMessage){
            return []
        }

        if(resultMessage.message.call){
            return [{
                callFn:resultMessage.message.call.name,
                callParams:resultMessage.message.call.params,
                tags:resultMessage.message.metadata,
            }]
        }else{
            return [{
                role:resultMessage.message.role,
                content:resultMessage.message.content,
                tags:resultMessage.message.metadata,
            }]
        }
    }

}

export interface AiCompletionServiceCallFunctionOptions
{
    descriptionOverride?:string;
    render?:boolean;
    applyToMessage?:AiCompletionMessage;
}

const expandModels=(models:string[]|null|undefined,allowed:readonly string[]):readonly string[]=>{
    if(!models){
        return allowed;
    }

    if(models.includes(aiCompleteDefaultModel)){
        models=[...models];
        for(let i=0;i<models.length;i++){
            if(models[i]===aiCompleteDefaultModel){
                models.splice(i,1,...allowed);
                i+=allowed.length-1;
            }
        }
    }

    return models;
}

const checkModelAccess=(model:string,provider:AiCompletionProvider,options:CompletionOptions|undefined)=>{
    const allowed=provider.getAllowedModels?.()??[];
    const expanded=expandModels(options?.allowedModels,allowed);

    if(!allowed.includes(model) || !expanded.includes(model)){
        throw new UnauthorizedError(`User does not have access to model (${model})`);
    }
}
