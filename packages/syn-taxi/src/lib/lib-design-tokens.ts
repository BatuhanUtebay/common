import { BehaviorSubject } from "rxjs";
import { defaultDesignTokenVariation, DesignTokens, designTokenValues, DesignTokenVariation } from "./tokens";


export const designVariationSubject=new BehaviorSubject<DesignTokenVariation>(defaultDesignTokenVariation);

export const dt=():DesignTokens=>{
    return designTokenValues[designVariationSubject.value];
}
