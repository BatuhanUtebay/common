import { LoadingDotsProps } from "@iyio/react-common";

export interface ConvoLangTheme
{
    foregroundColor:string;
    inputBackground:string;
    inputPadding:string;
    inputMargin:string;
    inputShadow:string;
    inputBorder:string;
    buttonColor:string;
    buttonForeground:string;
    borderRadius:string;
    padding:string;
    gap:string;

    userBackground:string;
    userColor:string;
    userBorder:string;
    userWeight:string;
    agentBackground:string;
    agentColor:string;
    agentWeight:string;
    agentBorder:string;
    messageBorderRadius:string;
    messagePadding:string;
    maxMessageWidth:string;
    fontSize:string;
    loaderProps?:LoadingDotsProps;
    wrapLoader?:boolean;

}

export const defaultLightConvoLangTheme:ConvoLangTheme={
    foregroundColor:'#111111',
    inputBackground:'#ffffff',
    inputPadding:'0.5rem',
    inputMargin:'0 0.5rem 0.5rem 0.5rem',
    inputShadow:'none',
    inputBorder:'none',
    borderRadius:'0.5rem',
    buttonColor:'#cccccc',
    buttonForeground:'#111111',
    padding:'1rem',
    gap:'1rem',
    fontSize:'1rem',
    userBackground:'#4F92F7',
    userColor:'inherit',
    userBorder:'none',
    userWeight:'inherit',
    agentBackground:'#3B3B3D',
    agentColor:'inherit',
    agentWeight:'inherit',
    agentBorder:'none',
    maxMessageWidth:'700px',
    messageBorderRadius:'2rem',
    messagePadding:'10px 14px',
} as const

export const defaultDarkConvoLangTheme:ConvoLangTheme={
    ...defaultLightConvoLangTheme,
    foregroundColor:'#ffffff',
    inputBackground:'#333333',
    inputShadow:'0 0 20px 0px #ffffff11',
    inputBorder:'1px solid #ffffff22',
    buttonColor:'#333333',
    buttonForeground:'#ffffff',
    agentBorder:'1px solid rgba(255, 255, 255, 0.11)',
} as const
