import { AutoLayoutType, BaseLayoutProps } from "@iyio/common";
import { Alo2x3, Alo2x3Style } from "./Alo2x3";
import { Alo3x2, Alo3x2Style } from "./Alo3x2";
import { Alo3x3, Alo3x3Style } from "./Alo3x3";
import { AloAutoGrid, AloAutoGridStyle, getAloAutoGridStyleVars } from "./AloAutoGrid";
import { AloQuad, AloQuadStyle } from "./AloQuad";
import { AloSideBy, AloSideByStyle } from "./AloSideBy";
import { AloSideBySideScrollLeft, AloSideBySideScrollLeftStyle } from "./AloSideBySideScrollLeft";
import { AloSideBySideScrollRight, AloSideBySideScrollRightStyle } from "./AloSideBySideScrollRight";
import { AloTopBottom, AloTopBottomStyle } from "./AloTopBottom";
import { AloTriBottom, AloTriBottomStyle } from "./AloTriBottom";
import { AloTriLeft, AloTriLeftStyle } from "./AloTriLeft";
import { AloTriRight, AloTriRightStyle } from "./AloTriRight";
import { AloTriTop, AloTriTopStyle } from "./AloTriTop";
import { AutoLayoutCtrl } from "./AutoLayoutCtrl";
import { AutoLayoutCompInfo, AutoLayoutSlotOptions, AutoLayoutTypeProps } from "./auto-layout-lib";

export const getAutoLayoutTypeComp=(
    type:AutoLayoutType,
    childAry:any[],
    count:number,
    ctrl:AutoLayoutCtrl,
    layoutProps:BaseLayoutProps,
    slotOptions:AutoLayoutSlotOptions
):AutoLayoutCompInfo|undefined=>{

    const props:AutoLayoutTypeProps={
        childAry:childAry,
        count:count,
        layoutProps:layoutProps,
        slotOptions:slotOptions,
        ctrl:ctrl,
    }

    switch(type){

        case 'sideBySide': return {
            comp:<AloSideBy {...props}/>,
            className:AloSideByStyle.root(),
        }

        case 'sideBySideScrollRight': return {
            comp:<AloSideBySideScrollRight {...props}/>,
            className:AloSideBySideScrollRightStyle.root(),
        }

        case 'sideBySideScrollLeft': return {
            comp:<AloSideBySideScrollLeft {...props}/>,
            className:AloSideBySideScrollLeftStyle.root(),
        }

        case 'topBottom': return {
            comp:<AloTopBottom {...props}/>,
            className:AloTopBottomStyle.root(),
        }

        case 'triLeft': return {
            comp:<AloTriLeft {...props}/>,
            className:AloTriLeftStyle.root(),
        }

        case 'triRight': return {
            comp:<AloTriRight {...props}/>,
            className:AloTriRightStyle.root(),
        }

        case 'triTop': return {
            comp:<AloTriTop {...props}/>,
            className:AloTriTopStyle.root(),
        }

        case 'triBottom': return {
            comp:<AloTriBottom {...props}/>,
            className:AloTriBottomStyle.root(),
        }

        case 'quad': return {
            comp:<AloQuad {...props}/>,
            className:AloQuadStyle.root(),
        }

        case '2x3': return {
            comp:<Alo2x3 {...props}/>,
            className:Alo2x3Style.root(),
        }

        case '3x2': return {
            comp:<Alo3x2 {...props}/>,
            className:Alo3x2Style.root(),
        }

        case '3x3': return {
            comp:<Alo3x3 {...props}/>,
            className:Alo3x3Style.root(),
        }

        case 'autoGrid': return {
            comp:<AloAutoGrid {...props}/>,
            className:AloAutoGridStyle.root(),
            style:getAloAutoGridStyleVars(props),
        }

        default:
            return undefined;
    }
}
