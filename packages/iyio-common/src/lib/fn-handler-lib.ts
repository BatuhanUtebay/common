import { BaseError } from './errors';
import { FnBaseHandlerOptions, FnEvent, FnHandler, FnHandlerOptions, RawFnFlag, RawFnResult, createFnError, isFnInvokeEvent } from './fn-handler-types';
import { FnEventTransformers } from './fn-handler.deps';
import { createHttpBadRequestResponse, createHttpErrorResponse, createHttpJsonResponse, createHttpNoContentResponse, createHttpNotFoundResponse, createHttpStringResponse } from './http-server-lib';
import { HttpMethod } from './http-types';
import { parseJwt } from './jwt';
import { validateJwt } from './jwt-lib';
import { getObjKeyCount, queryParamsToObject } from './object';
import { zodCoerceObject } from './zod-helpers';

export const fnHandler=async ({
    evt,
    context,
    handler,
    logRequest,
    returnsHttpResponse,
    inputScheme,
    outputScheme,
    httpLike,
    defaultHttpMethod=httpLike?'POST':undefined,
    defaultHttpPath=httpLike?'/':undefined,
    defaultQueryString,
    inputProp,
    inputParseProp=httpLike?'body':undefined,
}:FnHandlerOptions)=>{
    if(logRequest){
        console.info('serverlessHandler',evt);
    }

    const fnInvokeEvent=isFnInvokeEvent(evt)?evt:undefined;

    const requestContextHttpPath=evt?.requestContext?.http?.path;
    const requestContextHttpMethod=evt?.requestContext?.http?.method;
    const requestContextPath=evt?.requestContext?.path??defaultHttpPath;
    const requestContextMethod=evt?.requestContext?.httpMethod??defaultHttpMethod;

    const query=getQuery(evt,defaultQueryString);

    let path=(
        (requestContextHttpPath)??
        (requestContextPath)??
        '/'
    )
    const method=(
        requestContextHttpMethod??
        requestContextMethod??
        'POST'
    )?.toUpperCase() as HttpMethod;

    if(!path.startsWith('/')){
        path='/'+path;
    }

    const isHttp=(
        (requestContextHttpPath!==undefined && requestContextHttpMethod!==undefined) ||
        (requestContextPath!==undefined && requestContextMethod!==undefined)
    )
    const isApiGateway=!!requestContextMethod;
    //const isLambdaUrl=!!requestContextHttpMethod;
    const cors=isApiGateway;
    const responseDefaults={cors};

    let input=(
        inputProp?
            evt[inputProp]
        :inputParseProp?
            (typeof evt[inputParseProp]==='string')?JSON.parse(evt[inputParseProp]):undefined
        :fnInvokeEvent?
            fnInvokeEvent.input
        :isHttp?
            (evt.body?(typeof evt.body === 'string')?JSON.parse(evt.body):evt.body:((method==='GET' || getObjKeyCount(query)) && inputScheme)?zodCoerceObject(inputScheme,query)?.result:undefined)
        :
            evt
    );

    if(inputScheme){
        const parsed=inputScheme.safeParse(input);
        if(parsed.success){
            input=parsed.data;
        }else if(parsed.success===false){
            if(logRequest){
                console.error('serverlessHandler - Invalid input',input);
            }
            if(isHttp){
                return createHttpBadRequestResponse(parsed.error.message);
            }else{
                return createFnError(400,parsed.error.message,parsed.error);
            }
        }
    }

    const routePath=`${method}:${path}`;

    let sub:string|undefined=undefined;
    let claims:Record<string,any>={};

    if(fnInvokeEvent?.jwt){
        if(!validateJwt(fnInvokeEvent.jwt)){
            console.error('RouteHandler received an invalid JWT or the the JWT was unable to be validated.');
            if(isHttp){
                return createHttpBadRequestResponse('Invalid JWT',responseDefaults);
            }else{
                return createFnError(400,'Invalid JWT');
            }
        }
        claims=parseJwt(fnInvokeEvent.jwt)??{};
        sub=claims['sub'];
    }

    const headers:Record<string,string>=evt.headers??{};
    const remoteAddress:string|undefined=headers['x-forwarded-for'];

    const fnEvent:FnEvent={
        sourceEvent:evt,
        context,
        path,
        method,
        routePath,
        query,
        headers,
        claims,
        sub,
    }

    if(typeof remoteAddress === 'string'){
        fnEvent.remoteAddress=remoteAddress;
    }

    if(typeof evt.requestContext?.connectionId === 'string'){
        fnEvent.connectionId=evt.requestContext.connectionId;
    }

    if(typeof evt.requestContext?.eventType === 'string'){
        fnEvent.eventType=evt.requestContext.eventType;
    }

    const transformers=FnEventTransformers.all();
    for(const t of transformers){
        await t(fnEvent);
    }

    try{
        if(method==='OPTIONS'){
            if(isHttp){
                return createHttpNoContentResponse(responseDefaults);
            }
        }
        let result=await handler(fnEvent,input);

        if(isRawFnResult(result)){
            return result.result;
        }

        if(outputScheme){
            const parsed=outputScheme.safeParse(result);
            if(parsed.success){
                result=parsed.data;
            }else if(parsed.success===false){
                console.error(`handler result does does not match output scheme.`,parsed.error);
                if(isHttp){
                    return createHttpErrorResponse('Internal server error - invalid return data',responseDefaults);
                }else{
                    return createFnError(500,'Internal server error - invalid return data');
                }
            }
        }

        if(isHttp){
            if(result===null){
                return createHttpNotFoundResponse('Resource not found',responseDefaults);
            }else if(result===undefined){
                return createHttpNoContentResponse(responseDefaults);
            }else if(returnsHttpResponse){
                return result;
            }else{
                return createHttpJsonResponse(result,responseDefaults);
            }
        }else{
            return result;
        }
    }catch(ex){
        let logError=true;
        let code=500;
        let message='Internal server error';
        if(ex instanceof BaseError){
            logError=ex.cErrT<400 || ex.cErrT>499;
            code=ex.cErrT;
            message=ex.message;
        }
        if(logError){
            console.error(`RouteHandler failed. path=${routePath}`,ex);
        }
        if(isHttp){
            return createHttpStringResponse(code,message,responseDefaults);
        }else{
            return createFnError(code,message);
        }
    }
}

const getQuery=(evt?:any,defaultQueryString?:string):Record<string,string>=>{
    const _queryString=evt?.rawQueryString??defaultQueryString;
    return evt?.queryStringParameters??_queryString?queryParamsToObject(_queryString):{}
}

export const createFnHandler=(handler:FnHandler,options:FnBaseHandlerOptions={}):((evt:any,context:any)=>Promise<any>) & {rawHandler:FnHandler}=>{
    const handlerProxy=(evt:any,context:any)=>fnHandler({
        ...options,
        handler,
        evt,
        context,
    });

    handlerProxy.rawHandler=handler;

    return handlerProxy;
}

export const isRawFnResult=(value:any): value is RawFnResult=>{
    if(!value){
        return false;
    }
    return (value as RawFnResult).rawFlag===RawFnFlag;
}

export const createRawFnResult=(result:any):RawFnResult=>{
    return {
        result,
        rawFlag:RawFnFlag
    }
}

export const createEmptyEventSource=():FnEvent=>({
    sourceEvent:{},
    context:{},
    path:'/',
    method:'GET',
    routePath:'/',
    query:{},
    headers:{},
    claims:{},
})
