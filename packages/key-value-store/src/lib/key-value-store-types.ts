import { CancelToken, IOpDisposable, ListPointer, Query, TypeDef, ValuePointer } from "@iyio/common";

export type KeyValueStoreOp='get'|'put'|'patch'|'create'|'delete'|'query'|'watch'|'watchQuery';

export interface KeyValueStoreMatch
{
    /**
     * The matched store
     */
    store:IKeyValueStore;

    /**
     * The scoped key after matching the store
     */
    scopedKey:string;
}


export interface KeyValueStoreKeyScope
{

    keyBase?:string;

    keyReg?:RegExp;

    keyRegIndex?:number;

    keyCondition?:(key:string)=>string|boolean;
}

export interface KeyValueStoreScope extends KeyValueStoreKeyScope
{

    supports?(key:string,op:KeyValueStoreOp):boolean;
}

export interface KeyValueStoreProvider<T=any> extends KeyValueStoreScope
{
    providerType:TypeDef<IKeyValueStore<T>|IWithKeyStoreAdapter<T>>;
}

export interface CreateKeyValueResult<T=any>
{
    key:string;
    value:T;
}

export interface KeyValueStoreOpMethods<T=any>
{
    /**
     * Returns a value by key
     */
    getAsync?<TK extends T=T>(key:string,cancel?:CancelToken):Promise<TK|undefined>;

    /**
     * Updates or creates a value with the given key
     */
    putAsync?<TK extends T=T>(key:string,value:TK,cancel?:CancelToken):Promise<void>;

    /**
     * Updates an existing value
     */
    patchAsync?<TK extends T=T>(key:string,value:Partial<TK>,cancel?:CancelToken):Promise<void>;

    /**
     * Creates a new value and returns the newly create value and its key.
     * @param baseKey The key of the value minus its primary key value
     * @param primaryKey The primary key property of the value
     * @param value The value to be created
     */
    createAsync?<TK extends T=T>(baseKey:string,primaryKey:(keyof TK)|null|undefined,value:Partial<TK>,cancel?:CancelToken):Promise<CreateKeyValueResult<TK>>;

    /**
     * Creates a new value but does not return the created value. This function can be used as an
     * optimization when you don't need the created value. If not defined createAsync will be used
     * as a fallback.
     * @param baseKey The key of the value minus its primary key value
     * @param primaryKey The primary key property of the value
     * @param value The value to be created
     */
    createNoReturnAsync?<TK extends T=T>(baseKey:string,primaryKey:(keyof TK)|null|undefined,value:Partial<TK>,cancel?:CancelToken):Promise<void>;


    /**
     * Deletes a value by key. If the provider can not determine if the value was deleted
     * undefined will be returned.
     */
    deleteAsync?(key:string,cancel?:CancelToken):Promise<boolean|undefined>;

    /**
     * Returns a collection of values based on the given query.
     */
    queryAsync?<TK extends T=T>(baseKey:string,query:Query,cancel?:CancelToken):Promise<TK[]>;

    /**
     * Watches a value with the given key. The returned pointer will update its value subject
     * as the value changes.
     */
    watch?<TK extends T=T>(key:string):ValuePointer<TK>|undefined;

    /**
     * Watches a collection of items based on the given query. Changes to the collection can be
     * listened to by using the pointers changeCount.
     */
    watchQuery?<TK extends T=T>(baseKey:string,query:Query):ListPointer<TK>|undefined;

}

export interface IKeyValueStore<T=any> extends KeyValueStoreOpMethods<T>, KeyValueStoreScope, IOpDisposable
{
    getWatchCount?():number;
}

export const isIWithKeyStoreAdapter=(value:any):value is IWithKeyStoreAdapter=>(
    typeof (value as Partial<IWithKeyStoreAdapter>)?.getStoreAdapter === 'function'
)

export interface IWithKeyStoreAdapter<T=any>
{
    getStoreAdapter():IKeyValueStore<T>;
}
