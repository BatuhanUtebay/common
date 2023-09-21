import { HttpClient, Scope, httpClient } from '@iyio/common';
import { httpAiCompletionUrlParam } from './_type.ai-complete';
import { AiCompletionMessage, AiCompletionProvider, AiCompletionRequest, AiCompletionResult } from './ai-complete-types';

export interface HttpAiCompletionProviderOptions
{
    url:string;
    httpClient?:HttpClient;
}

export class HttpAiCompletionProvider implements AiCompletionProvider
{

    public static fromScope(scope:Scope){
        return new HttpAiCompletionProvider({
            url:httpAiCompletionUrlParam(scope),
            httpClient:httpClient(scope),
        })
    }

    private readonly url:string;
    private readonly httpClient:HttpClient;

    public constructor({
        url,
        httpClient:hc=httpClient()
    }:HttpAiCompletionProviderOptions){

        this.url=url;
        this.httpClient=hc;
    }

    public async completeAsync(lastMessage:AiCompletionMessage,request: AiCompletionRequest):Promise<AiCompletionResult>
    {
        const r=await this.httpClient.postAsync<AiCompletionResult>(this.url,request);

        return r??{options:[]}
    }

}
