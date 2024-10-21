import { MdxUiComponentCache } from "@iyio/mdx-ui-builder";
import { createVfsMdxUiComponentCache } from "./createVfsMdxUiComponentCache";

let defaultCache:MdxUiComponentCache|undefined=undefined;

export const getDefaultMdxUiComponentCache=():MdxUiComponentCache=>{
    return defaultCache??(defaultCache=createVfsMdxUiComponentCache());
}
