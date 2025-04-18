// @ts-ignore
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import { atDotCss } from "@iyio/at-dot-css";
import { BaseLayoutProps, getErrorMessage } from "@iyio/common";
import { MdxUiBuilder, MdxUiBuilderError, MdxUiBuilderOptions, MdxUiDeconstructProp, MdxUiImportReplacer, MdxUiLiveComponentGenerator } from "@iyio/mdx-ui-builder";
import { ErrorBoundary, HookCtrl, HookCtrlReactContext, Text, View, useCreateHookCtrl, useSubject } from "@iyio/react-common";
import { useEffect, useMemo, useRef, useState } from "react";
import { MdxUiBuilderErrorView } from "./MdxUiBuilderErrorView";


export interface MdxUiBuilderViewProps
{
    code?:string;
    onChange?:(code:string)=>void;
    components?:Record<string,any>;
    imports?:Record<string,any>;
    builderOptions?:MdxUiBuilderOptions;
    liveComponentGenerator?:MdxUiLiveComponentGenerator;
    importReplacer?:MdxUiImportReplacer;
    onError?:(error:MdxUiBuilderError|null)=>void;
    hideError?:boolean;
    onBuilderChange?:(builder:MdxUiBuilder)=>void;
    compProps?:Record<string,any>;
    hookCtrl?:HookCtrl;
    enableJsBlocks?:boolean;
    deconstructProps?:(string|MdxUiDeconstructProp)[];
    styleName?:string;
    disableHighlighting?:boolean;
    isPreview?:boolean;
    fallback?:any;
}

export function MdxUiBuilderView({
    code,
    onChange,
    components,
    imports,
    builderOptions,
    liveComponentGenerator,
    importReplacer,
    onError,
    hideError,
    onBuilderChange,
    compProps,
    hookCtrl:hookCtrlProp,
    enableJsBlocks,
    deconstructProps,
    styleName,
    disableHighlighting,
    isPreview,
    fallback,
    ...props
}:MdxUiBuilderViewProps & BaseLayoutProps){

    const refs=useRef({builderOptions,liveComponentGenerator,importReplacer,onChange,onBuilderChange,styleName});
    refs.current.onChange=onChange;
    refs.current.onBuilderChange=onBuilderChange;
    refs.current.styleName=styleName;

    const [rootElem,setRootElem]=useState<HTMLElement|null>(null);

    const builder=useMemo(()=>{

        if(!rootElem){
            return null;
        }

        const compilerOptions={...refs.current.builderOptions?.compilerOptions}
        if(refs.current.importReplacer){
            compilerOptions.importReplacer=refs.current.importReplacer;
        }
        if(enableJsBlocks){
            compilerOptions.enableJsBlocks=true;
        }
        if(deconstructProps){
            compilerOptions.deconstructProps=[...deconstructProps,...(compilerOptions.deconstructProps??[])];
        }
        if(refs.current.styleName){
            compilerOptions.styleName=styleName;
        }

        return new MdxUiBuilder({
            ...refs.current.builderOptions,
            liveComponentGenerator:refs.current.liveComponentGenerator??refs.current.builderOptions?.liveComponentGenerator,
            enableLiveComponents:true,
            reactImports:{Fragment,jsx,jsxs},
            compilerOptions,
            highlighter:{
                root:rootElem,
            }
        });

    },[rootElem,enableJsBlocks,deconstructProps]);

    useEffect(()=>{
        if(!builder){
            return;
        }
        return ()=>{
            builder.dispose();
        }
    },[builder]);

    useEffect(()=>{
        if(!builder){
            return;
        }
        builder.highlighter.mode=disableHighlighting?'none':'hover';
    },[builder,disableHighlighting]);

    useEffect(()=>{
        if(!builder){
            return;
        }
        builder.liveImports=imports??null;
    },[imports,builder]);

    useEffect(()=>{
        if(!builder){
            return;
        }
        builder.liveComponents=components??null;
    },[components,builder]);

    useEffect(()=>{
        if(!builder){
            return;
        }
        builder.code=code??null;
    },[code,builder]);

    useEffect(()=>{
        if(!builder){
            return;
        }
        const sub=builder.onCodeChangeSubmission.subscribe(v=>{
            refs.current.onChange?.(v);
        })
        return ()=>{
            sub.unsubscribe();
        }
    },[builder]);

    useEffect(()=>{
        if(builder){
            refs.current.onBuilderChange?.(builder);
        }
    },[builder]);

    const state=useSubject(builder?.stateSubject);
    const error=state?.error;

    const compRef=useSubject(builder?.lastLiveComponentSubject);
    const Comp=compRef?.Comp;

    useEffect(()=>{
        builder?.highlighter.update();
    },[builder,Comp]);

    useEffect(()=>{
        onError?.(error??null);
    },[onError,error]);

    const hookCtrl=useCreateHookCtrl(hookCtrlProp);


    return (
        <HookCtrlReactContext.Provider value={hookCtrl}>
            <div className={style.root(null,null,props)} ref={setRootElem}>
                <div className={style.container()} key={error?1:0}>

                    <ErrorBoundary fallbackWithError={(err)=>(
                        <View col>
                            <Text text="Runtime Error"/>
                            <Text sm colorMuted text="Your component compiled but may fail at runtime when a user is using it." mb1 mt050/>
                            {getErrorMessage(err)}
                        </View>
                    )}>
                        {Comp?<Comp
                            hookCtrl={hookCtrl}
                            comp={hookCtrl.state}
                            isPreview={isPreview}
                            {...compProps}
                        />:fallback}
                    </ErrorBoundary>

                    {error && !hideError && <MdxUiBuilderErrorView absBottomCenter m1 error={error} />}

                </div>
            </div>
        </HookCtrlReactContext.Provider>
    )

}

const style=atDotCss({name:'MdxUiBuilderView',css:`
    @.root{
        display:flex;
        flex-direction:column;
        flex:1;
    }
    @.container{
        display:flex;
        flex-direction:column;
        flex:1;
        position:relative;
    }
`});
