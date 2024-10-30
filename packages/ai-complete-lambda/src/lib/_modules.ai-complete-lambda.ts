import { AiCompletionProviders } from "@convo-lang/ai-complete";
import { ScopeRegistration } from "@iyio/common";
import { LambdaAiCompletionProvider } from "./LambdaAiCompletionProvider";

export const aiCompleteLambdaModule=(scope:ScopeRegistration)=>{
    scope.addProvider(AiCompletionProviders,scope=>LambdaAiCompletionProvider.fromScope(scope));
}
