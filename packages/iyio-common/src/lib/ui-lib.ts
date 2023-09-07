import { BehaviorSubject } from "rxjs";
import { DisposeCallback, HashMap } from "./common-types";
import { ReadonlySubject } from "./rxjs-types";
import { getUriHost, getUriProtocol } from "./uri";

export const removeOnUiReadyClassName='iyio-removeOnUiReady';
export const removeOnUiReadyDelayedClassName='iyio-removeOnUiReadyDelayed';
export const uiReadyClassName='iyio-uiReady';
export const uiReadyDelayedClassName='iyio-uiReadyDelayed';

export interface UiActionItem
{
    id?:string;
    title?:string;
    icon?:string;
    to?:string;
    type?:string;
    action?:(item:UiActionItem)=>void;
    linkTarget?:string;
    data?:any;
}

export interface UiActionSubItem extends UiActionItem
{
    sub?:UiActionItem[];
}

export interface UiActionRecursiveSubItem extends UiActionItem
{
    sub?:UiActionRecursiveSubItem[];
}

export type RouteQuery=HashMap<string|string[]>;

export interface RouteInfo
{
    key:string;
    path:string;
    route:string;
    asPath:string;
    query:HashMap<string|string[]|undefined>;
}

export interface UiRouterOpenOptions
{
    target?:string;
}

export type UiRouterEvt=
{
    /**
     * An index that increments for each event that occurs.
     */
    index:number;
    cancel:boolean;
    data?:Record<string|symbol,any>;
} & (
    {
        type:'push';
        path:string;
        query?:RouteQuery;

    } |
    {
        type:'pop';
    } |
    {
        type:'open';
        uri:string;
        options?:UiRouterOpenOptions;
    }
)

export type UiRouterEvtType=UiRouterEvt['type'];

/**
 * Called before a ui routing event occurs. The listener can modify or cancel the event. Async
 * listeners will delay the routing event until they complete. If another routing event occurs
 * while an async listener is being awaited the routing event is canceled.
 */
export type UiRouterEvtListener=(evt:UiRouterEvt)=>void|Promise<void>;

export interface IUiRouter
{

    readonly routeId:string;

    readonly navItemsSubject:BehaviorSubject<UiActionRecursiveSubItem[]>;
    readonly navItems:UiActionRecursiveSubItem[];

    readonly activeNavItemSubject:ReadonlySubject<MatchedUiActionItem|null>;
    readonly activeNavItem:MatchedUiActionItem|null;

    readonly isLoadingSubject:ReadonlySubject<boolean>;
    readonly isLoading:boolean;

    dispose?():void;

    push(path:string,query?:RouteQuery):void|Promise<void>;

    pop():void|Promise<void>;

    open(uri:string,options?:UiRouterOpenOptions):void|Promise<void>;

    getCurrentRoute():RouteInfo;

    /**
     * Adds a routing event listener
     */
    addListener(listener:UiRouterEvtListener):void;

    /**
     * Adds a routing event listener that can be remove by calling the returned callback.
     */
    addListenerWithDispose(listener:UiRouterEvtListener):DisposeCallback;

    /**
     * Removes a routing event listener. Returns false if the listener was not found.
     */
    removeListener(listener:UiRouterEvtListener):boolean;
}

export const addQueryToPath=(path:string,query:RouteQuery|null|undefined)=>{
    if(!query){
        return path;
    }

    if(!path.includes('?')){
        path+='?';
    }

    for(const e in query){
        const q=query[e] as string|string[]
        if(q===undefined){
            continue;
        }
        if(Array.isArray(q)){
            for(const v of q){
                path+=encodeURIComponent(e)+'[]='+encodeURIComponent(v)+'&';
            }
        }else{
            path+=encodeURIComponent(e)+'='+encodeURIComponent(q)+'&';
        }
    }

    path=path.substring(0,path.length-1);

    return path;
}

export const shouldUseNativeNavigation=(path:string)=>(
    globalThis.location &&
    (
        (
            getUriProtocol(path) &&
            getUriHost(path)?.toLowerCase()!==globalThis.location.host
        ) ||
        path?.startsWith('#')
    )
    ?true:false
)

export interface MatchedUiActionItem
{
    match:UiActionRecursiveSubItem;
    matches:UiActionRecursiveSubItem[];
}
export const findMatchingUiActionItem=(matchItem:Partial<UiActionItem>,items:UiActionRecursiveSubItem[],maxDepth=100):MatchedUiActionItem|undefined=>{

    if(maxDepth<0){
        return undefined;
    }

    for(const item of items){
        let matched=true;
        for(const e in matchItem){
            if((matchItem as any)[e]!==(item as any)[e]){
                matched=false;
                break;
            }
        }
        if(matched){
            return {match:item,matches:[item]}
        }

        if(item.sub){
            const subMatch=findMatchingUiActionItem(matchItem,item.sub,maxDepth-1);
            if(subMatch){
                return {match:item,matches:[item,...subMatch.matches]}
            }

        }
    }

    return undefined;
}
