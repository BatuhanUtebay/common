import { JsonMemoryStore } from './JsonStore';
import { MemoryStore } from './MemoryStore';
import { RouterStore } from './RouterStore';
import { createScope } from './scope-lib';
import { testMountedStoreAsync, testStorePutGetDeleteAsync, testStoreWatchAsync } from './store-test-lib';
import { uuid } from './uuid';


const createMemoryStore=()=>new MemoryStore({cloneValues:true});

const createRouterStore=(mountPath:string)=>{

    const scope=createScope();
    const store=new RouterStore(scope);

    store.mount(mountPath,createMemoryStore);

    return store;
}

describe('MemoryStore',()=>{

    it('should put, get, delete',async ()=>{
        await testStorePutGetDeleteAsync('/',createMemoryStore());
    });

    it('should watch',async ()=>{
        await testStoreWatchAsync('/',createMemoryStore());
    });

    it('should meet standard mount operations',async ()=>{

        const scope=createScope();

        const basePath='tmp-memory/items/test-stuff'
        await testMountedStoreAsync(scope,basePath,{
            path:basePath,
            store:new MemoryStore({cloneValues:true})
        })
    })

});

describe('JsonMemoryStore',()=>{

    it('should put, get, delete',async ()=>{
        await testStorePutGetDeleteAsync('/',new JsonMemoryStore());
    });

    it('should watch',async ()=>{
        await testStoreWatchAsync('/',new JsonMemoryStore());
    });

    it('should meet standard mount operations',async ()=>{

        const scope=createScope();

        const basePath='tmp-memory/items/test-stuff'
        await testMountedStoreAsync(scope,basePath,{
            path:basePath,
            store:new JsonMemoryStore()
        })
    })

});

describe('RouterStore',()=>{

    const mountPath='/';

    it('should put, get, delete',async ()=>{
        await testStorePutGetDeleteAsync(mountPath,createRouterStore(mountPath));
    });

    it('should watch',async ()=>{
        await testStoreWatchAsync(mountPath,createRouterStore(mountPath));
    });

})

describe('RouterStore with mount path',()=>{

    const mountPath='/apps/'+uuid();

    it('should put, get, delete',async ()=>{
        await testStorePutGetDeleteAsync(mountPath,createRouterStore(mountPath));
    });

    it('should watch',async ()=>{
        await testStoreWatchAsync(mountPath,createRouterStore(mountPath));
    });

})
