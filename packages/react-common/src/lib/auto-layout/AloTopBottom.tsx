import { atDotCss } from "@iyio/at-dot-css";
import { Fragment } from "react";
import { AutoLayoutSlot } from "./AutoLayoutSlot";
import { AutoLayoutTypeProps } from "./auto-layout-lib";

export function AloTopBottom({
    childAry,
}:AutoLayoutTypeProps){

    return (
        <Fragment>

            <AutoLayoutSlot flex1 index={0}>
                {childAry[0]}
            </AutoLayoutSlot>

            <AutoLayoutSlot flex1 index={1}>
                {childAry[1]}
            </AutoLayoutSlot>

        </Fragment>
    )

}

export const AloTopBottomStyle=atDotCss({name:'AloTopBottom',namespace:'iyio',order:'framework',css:`
    @.root{
        flex-direction:column;
    }
`});
