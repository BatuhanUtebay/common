import { ConvoFunction, ConvoMessage, ConvoNonFuncKeyword, ConvoParsingError, ConvoParsingResult, ConvoStatement, ConvoValueConstant, convoNonFuncKeywords, convoValueConstants } from "./convo-types";

type StringType='"'|"'"|'>';

const fnMessageReg=/(>)\s*(\w+)?\s+(\w+)\s*([*?!]*)\s*(\()/gs;
const roleReg=/(>)\s*(\w+)\s*([*?!]*)/gs;

const statementReg=/([\s\n\r]*)((#|\)|\}\})|((\w+)(\??):)?\s*((\w+)\s*=)?\s*('|"|\w+\s*(\()|[\w.]+))/gs;
const spaceIndex=1;
const ccIndex=3;
const labelIndex=5;
const optIndex=6;
const setIndex=8;
const valueIndex=9;
const fnOpenIndex=10;

const returnTypeReg=/\s*->\s*(\w+)?\s*(\(?)/gs;

const numberReg=/^[.\d]/;

const singleStringReg=/(\{\{|')/gs;
const doubleStringReg=/(\{\{|")/gs;
const msgStringReg=/(\{\{|[\n\r]\s*>)/gs;

const space=/\s/;


if(globalThis.window){
    (window as any).__fnReg=fnMessageReg;
}

export const parseConvoCode=(code:string):ConvoParsingResult=>{

    code=code+'\n';

    const messages:ConvoMessage[]=[];

    let inMsg=false;
    let inFnMsg=false;
    let inFnBody=false;
    let msgName:string|null=null;
    let stringEndReg=singleStringReg;
    const stringStack:StringType[]=[];
    const stringStatementStack:ConvoStatement[]=[];
    let inString:StringType|null=null;
    let lastComment='';
    let index=0;
    let currentMessage:ConvoMessage|null=null;
    let currentFn:ConvoFunction|null=null;
    let error:string|undefined=undefined;
    const stack:ConvoStatement[]=[];
    const len=code.length;

    const openString=(type:StringType,s?:ConvoStatement):ConvoStatement=>{
        console.log('hio 👋 👋 👋 OPEN STRING """"""""" ',type);
        inString=type;
        stringStack.push(type);
        if(!s){
            s=addStatement({});
        }
        stringStatementStack.push(s);
        switch(type){

            case '\'':
                stringEndReg=singleStringReg;
                break;

            case '"':
                stringEndReg=doubleStringReg;
                break;

            case '>':
                stringEndReg=msgStringReg;
                break;
        }
        return s;
    }

    const closeString=()=>{
        const last=stringStatementStack[stringStatementStack.length-1];
        if(!last){
            error='No string on string stack';
            return false;
        }
        console.log('hio 👋 👋 👋 Close STRING """"""""" ',last?.fn?JSON.stringify(last,null,4):last?.value);
        if(stack.includes(last)){
            if(stack[stack.length-1]!==last){
                error='String not on top of stack';
                return false;
            }
            stack.pop();
        }
        stringStack.pop();
        stringStatementStack.pop();
        inString=null;
        return true;
    }

    const takeComment=()=>{
        index++;
        const newline=code.indexOf('\n',index);
        const comment=code.substring(index,newline).trim();
        console.log('hio 👋 👋 👋 comment',comment);
        if(lastComment.trim()){
            lastComment+='\n'+comment;
        }else{
            lastComment=comment
        }
        index=newline;
    }

    const addStatement=(s:ConvoStatement)=>{
        const last=stack[stack.length-1];
        if(!last){
            return s;
        }
        if(!last.params){
            last.params=[];
        }
        last.params.push(s);
        return s;
    }

    const endMsg=()=>{
        if( currentMessage?.statement &&
            !currentMessage.statement.fn &&
            (typeof currentMessage.statement.value === 'string')
        ){
            currentMessage.content=currentMessage.statement.value.trim();
            delete currentMessage.statement;
        }
        msgName=null;
        currentMessage=null;
        inMsg=false;
        stack.pop();
    }

    parsingLoop: while(index<len){



        if(inString){
            const strStatement=stringStatementStack[stringStatementStack.length-1];
            if(!strStatement){
                error='No string statement found';
                break parsingLoop;
            }
            let escaped:boolean;
            let embedFound:boolean;
            let endStringIndex:number;
            let nextIndex:number=index;
            const isMsgString=inString==='>';
            do{
                stringEndReg.lastIndex=nextIndex;
                const e=stringEndReg.exec(code)

                if(!e){
                    error='End of string not found';
                    break parsingLoop;
                }


                embedFound=e[0]==='{{';
                endStringIndex=e.index;
                nextIndex=(isMsgString && !embedFound)?e.index+e[0].length-1:e.index+e[0].length;
                console.log('hio 👋 👋 👋 string next index content |||||',code.substring(nextIndex,nextIndex+10),e);

                if(embedFound || isMsgString){
                    escaped=false;
                }else{
                    let backslashCount=0;
                    for(let bi=endStringIndex-1;bi>=0;bi--){
                        console.log('hio 👋 👋 👋 escape char',code[bi]);
                        if(code[bi]!=='\\'){
                            break;
                        }
                        backslashCount++;
                    }
                    console.log('hio 👋 👋 👋 backslash count',backslashCount);
                    escaped=backslashCount%2===1;
                }
            }while(escaped)

            let content=code.substring(index,endStringIndex);
            if(inFnMsg){
                content=unescapeStr(content);
            }

            index=nextIndex;
            if(embedFound){
                if(!strStatement.params){
                    strStatement.params=[];
                }
                if(!strStatement.fn){
                    strStatement.fn='add';
                    stack.push(strStatement);
                }
                strStatement.params.push({value:content});
                inString=null;
            }else{

                if(strStatement.params){// has embeds
                    if(content){
                        strStatement.params.push({value:content});
                    }
                }else{
                    strStatement.value=content;
                }
                if(!closeString()){
                    break parsingLoop;
                }
                if(isMsgString){
                    endMsg();
                }
                console.log('hio 👋 👋 👋 after string >>>>',code.substring(index,index+10));
            }
        }else if(inMsg || inFnMsg){

            statementReg.lastIndex=index;
            const match=statementReg.exec(code);
            if(!match){
                error=inFnMsg?'Unexpected end of function':'Unexpected end of message';
                break parsingLoop;
            }

            const cc=match.length===2?match[1]:match[ccIndex];

            console.log('hio 👋 👋 👋 statement match',index,`||${cc}||`,`(((${code.substring(index,index+10)})))`,match)//
            console.log(code.substring(index,index+match[0].length));

            if(match.index!==index){
                error='Token index match out of sync';
                break parsingLoop;
            }

            if(cc==='#'){
                index+=(match[spaceIndex] as string).length
                takeComment();
                continue;
            }else if(cc===')' || cc==='}}'){// close function
                lastComment=''
                if(!stack.length){
                    error='Unexpected end of function call';
                    break parsingLoop;
                }
                const endEmbed=cc==='}}';
                index+=match[0].length;
                if(!endEmbed){
                    stack.pop();
                }
                console.log('hio 👋 👋 👋 POP STACK',stack.map(s=>s.fn));
                if(endEmbed){
                    console.log('hio 👋 👋 👋 closing embed',code.substring(index,index+10));
                    const prevInStr=stringStack[stringStack.length-1];
                    if(!prevInStr){
                        error='Unexpected string embed closing found';
                        break parsingLoop;
                    }
                    inString=prevInStr;
                }else if(stack.length===0){

                    if(stringStack.length){
                        error='End of call stack reached within a string';
                        break parsingLoop;
                    }

                    if(!currentFn){
                        error='End of call stack reached without being in function';
                        break parsingLoop;
                    }

                    if(!inFnBody){
                        returnTypeReg.lastIndex=index;
                        const rMatch=returnTypeReg.exec(code);
                        console.log('hio 👋 👋 👋 BODY MATCH------',rMatch);
                        if(rMatch && rMatch.index===index){
                            console.log('hio 👋 👋 👋 ENTER BODY',);
                            index+=rMatch[0].length;

                            if(rMatch[1]){
                                currentFn.paramsName=rMatch[1];
                            }

                            if(rMatch[2]){
                                inFnBody=true;
                                const body:ConvoStatement={fn:'body',params:currentFn.body}
                                stack.push(body);
                                continue;
                            }
                        }
                    }

                    inFnMsg=false;
                    inFnBody=false;
                    currentFn=null;
                    msgName=null;

                }
                continue;
            }

            const val=match[valueIndex]||undefined;
            const label=match[labelIndex]||undefined;
            const opt=match[optIndex]?true:undefined;
            const set=match[setIndex]||undefined;

            const statement:ConvoStatement={}
            if(label){
                statement.label=label
            }
            if(opt){
                statement.opt=opt
            }
            if(set){
                statement.set=set
            }
            if(lastComment){
                statement.comment=lastComment;
                lastComment='';
            }
            addStatement(statement);

            if(match[fnOpenIndex]){//push function on stack
                if(!val || val.length<2){
                    error='function call name expected';
                    break parsingLoop;
                }
                statement.fn=val.substring(0,val.length-1).trim()

                stack.push(statement);
                console.log('hio 👋 👋 👋 PUSH STACK',stack.map(s=>s.fn));
            }else if(val==='"' || val==="'"){
                openString(val,statement);
            }else if(val && numberReg.test(val)){// number
                statement.value=Number(val);
            }else if(convoValueConstants.includes(val as ConvoValueConstant)){
                switch(val as ConvoValueConstant){

                    case 'true':
                        statement.value=true;
                        break;

                    case 'false':
                        statement.value=false;
                        break;

                    case 'null':
                        statement.value=null;
                        break;

                    case 'undefined':
                        statement.value=undefined;
                        break;

                    default:
                        error=`Unknown value constant - ${val}`;
                        break parsingLoop;
                }
            }else if(convoNonFuncKeywords.includes(val as ConvoNonFuncKeyword)){
                statement.keyword=val;
            }else{
                statement.varRef=val;
            }

            // label
            // assignment


            index+=match[0].length;
        }else{
            const char=code[index];
            if(!char){
                error='character expected'
                break parsingLoop;
            }
            if(char==='>' && (code[index-1]==='\n' || code[index-1]==='\r')){

                fnMessageReg.lastIndex=index;
                let match=fnMessageReg.exec(code);
                if(match && match.index==index){
                    msgName=match[3]??'';
                    if(!msgName){
                        error='function name expected';
                        break parsingLoop;
                    }
                    currentFn={
                        name:msgName,
                        body:[],
                        params:[],
                        description:lastComment||undefined,
                        scope:match[2]||undefined

                    }
                    currentMessage={
                        role:'function',
                        fn:currentFn
                    }
                    messages.push(currentMessage);
                    lastComment='';
                    stack.push({fn:'map',params:currentFn.params});
                    inFnMsg=true;
                    inFnBody=false;
                    index+=match[0].length;
                    console.log('hio 👋 👋 👋 match function',msgName);
                    continue;
                }

                roleReg.lastIndex=index;
                match=roleReg.exec(code);
                if(match && match.index==index){
                    msgName=match[2]??'';
                    if(!msgName){
                        error='message role expected';
                        break parsingLoop;
                    }
                    currentMessage={
                        role:msgName,
                    }
                    messages.push(currentMessage);
                    lastComment='';
                    inMsg=true;
                    const body:ConvoStatement={fn:'body'}
                    stack.push(body);
                    currentMessage.statement=openString('>');
                    index+=match[0].length;
                    console.log('hio 👋 👋 👋 match role',msgName);
                    continue;
                }

                error='Message or function expected';
                break parsingLoop;

            }else if(char==='#'){
                takeComment();
            }else if(space.test(char)){
                index++;
            }else{
                error='Unexpected character';
                break parsingLoop;
            }
        }
    }



    return {messages,endIndex:index,error:error?getConvoParsingError(code,index,error):undefined};

}

const getConvoParsingError=(code:string,index:number,message:string):ConvoParsingError=>{

    let lineNumber=1;
    for(let i=0;i<=index;i++){
        if(code[i]==='\n'){
            lineNumber++;
        }
    }

    const s=Math.max(0,code.lastIndexOf('\n',index));
    let e=code.indexOf('\n',index);
    if(e===-1){
        e=code.length;
    }

    const neg=Math.min(index,10);

    return {
        message,
        index,
        lineNumber,
        line:code.substring(s,e).trim(),
        near:(
            code
            .substring(e-10,e+20)
            .replace(/[\n]/g,'↩︎').replace(/[\s]/g,'•')
            +'\n'+' '.repeat(neg)+'^'
        ),
    }
}

const unescapeStr=(str:string):string=>str.replace(/\\(.)/g,(_,char)=>{

    switch(char){
        case 'n':
            return '\n';
        case 'r':
            return '\n';
        case 't':
            return '\t';
    }

    return char;
});
