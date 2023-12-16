
export type ConvoExecAllowMode='disable'|'ask'|'allow'

export interface ConvoCliConfig
{
    env?:Record<string,string>;
    /**
     * Contains how shell command execution is allowed
     */
    allowExec?:ConvoExecAllowMode|ConvoExecConfirmCallback;

    /**
     * If true values of the env property with override process.env values
     */
    overrideEnv?:boolean;

    /**
     * @default "vision"
     */
    capabilities?:string;
    apiKey?:string;
    apiBaseUrl?:string;
    chatModel?:string;
    audioModel?:string;
    imageModel?:string;
    visionModel?:string;
    secrets?:string;
}

export interface ConvoCliOptions
{
    /**
     * Path to a ConvoCliConfig file
     */
    config?:string;

    /**
     * Inline configuration as json
     */
    inlineConfig?:string;

    /**
     * Path to a source convo file
     */
    source?:string;

    /**
     * If true the source will be read from stdin
     */
    stdin?:boolean;

    /**
     * Inline convo code
     */
    inline?:string;

    /**
     * If true the CLI will operate in command mode which will allow function calling to be passed
     * though stdin and stdout
     */
    cmdMode?:boolean;

    /**
     * If true each line of output will be prefixed with characters to indicating what the output
     * is related to.
     */
    prefixOutput?:boolean;

    /**
     * If true the shared variable state will be printed
     */
    printState?:boolean;

    /**
     * If true the flattened messages will be printed
     */
    printFlat?:boolean;

    /**
     * If true the messages will be printed
     */
    printMessages?:boolean;

    /**
     * If true the give convo code will be parsed and output as JSON instead of executing the
     * code.
     */
    parse?:boolean;

    /**
     * JSON formatting used if the parse option is true
     */
    parseFormat?:number;

    /**
     * Either a function that will be called with each chunk of generated code or a path to write
     * output to. If out equals "." then the source path will be used. This allows you to run a
     * convo script then output the results back into the same file.
     */
    out?:((...chunks:string[])=>void)|string;

    /**
     * If true the output of the executor is buffered to be used later.
     */
    bufferOutput?:boolean;

    /**
     * Contains how shell command execution is allowed
     */
    allowExec?:ConvoExecAllowMode|ConvoExecConfirmCallback;

    /**
     * Conversation content to prepend to source
     */
    prepend?:string;

    /**
     * The current working directory used for context execution
     */
    exeCwd?:string;
}

export type ConvoExecConfirmCallback=(command:string,commandIndex:number)=>Promise<boolean>|boolean;
