import { atDotCss } from "@iyio/at-dot-css";
import { ConversationUiCtrl } from "@iyio/convo-lang";
import { ConversationView } from '@iyio/convo-lang-react';
import { useMemo } from "react";

export interface BrowserConversationViewProps
{
    x?:any;
    length:number;
}

export function BrowserConversationView({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    x,
    length
}:BrowserConversationViewProps){

    const ctrl=useMemo(()=>new ConversationUiCtrl(),[]);

    return (
        <div className={style.root()}>
            {Array(length)}[p]
            <ConversationView
                ctrl={ctrl}
                className={style.conversation()}
                enabledSlashCommands
                theme="dark"
            />

        </div>
    )

}

const style=atDotCss({name:'BrowserConversationView',css:`
    @.root{
        display:flex;
        flex-direction:column;
        flex:1;
    }
    @.conversation{
        flex:1;

    }
`});
