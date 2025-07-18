import { 
  CopilotRuntime, 
  copilotRuntimeNextJSAppRouterEndpoint,
  CopilotServiceAdapter
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { NextRequest } from "next/server";

export interface CreateYaiNexusHandlerOptions {
  backendUrl: string;
  logging?: {
    enabled?: boolean;
    progressive?: boolean;
  };
}

/**
 * Lightweight adapter that proxies requests to AG-UI HttpAgent
 * This is much simpler than the previous 180-line adapter
 */
class YaiNexusServiceAdapter implements CopilotServiceAdapter {
  private httpAgent: HttpAgent;

  constructor(backendUrl: string) {
    this.httpAgent = new HttpAgent({
      url: backendUrl,
      description: "YAI Nexus Agent for AG-UI protocol"
    });
  }

  async process(request: any): Promise<any> {
    // Since HttpAgent expects RunAgentInput format, we need minimal conversion
    const agentInput = {
      threadId: request.threadId || 'default',
      runId: request.runId || `run_${Date.now()}`,
      messages: request.messages || [],
      tools: request.tools || [],
      context: [],
      state: request.state || null,
    };

    // Use HttpAgent's runAgent method for non-streaming
    await this.httpAgent.runAgent(agentInput);
    
    // For now, return a simple response
    // The HttpAgent handles the AG-UI protocol internally
    return {
      id: `response_${Date.now()}`,
      content: "Response from YAI Nexus backend",
      role: "assistant"
    };
  }

  async *stream(request: any): AsyncIterable<any> {
    // Since HttpAgent expects RunAgentInput format, we need minimal conversion
    const agentInput = {
      threadId: request.threadId || 'default',
      runId: request.runId || `run_${Date.now()}`,
      messages: request.messages || [],
      tools: request.tools || [],
      context: [],
      state: request.state || null,
    };

    // Use HttpAgent's run method for streaming
    const events$ = this.httpAgent.run(agentInput);
    
    // Convert Observable to AsyncIterable
    yield* this.observableToAsyncIterable(events$);
  }

  private async *observableToAsyncIterable(observable: any): AsyncIterable<any> {
    const chunks: any[] = [];
    let completed = false;
    let error: any = null;

    const subscription = observable.subscribe({
      next: (chunk: any) => chunks.push(chunk),
      error: (err: any) => { error = err; },
      complete: () => { completed = true; }
    });

    try {
      while (!completed && !error) {
        if (chunks.length > 0) {
          const chunk = chunks.shift();
          // Convert AG-UI events to CopilotKit format
          yield {
            type: 'content',
            content: chunk.type || 'event',
            data: chunk
          };
        } else {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      if (error) throw error;

      // Process remaining chunks
      while (chunks.length > 0) {
        const chunk = chunks.shift();
        yield {
          type: 'content', 
          content: chunk.type || 'event',
          data: chunk
        };
      }
    } finally {
      subscription.unsubscribe();
    }
  }
}

/**
 * Creates a Next.js API route handler that connects CopilotKit frontend
 * with yai-nexus-agentkit Python backend using AG-UI protocol
 * 
 * @param options Configuration options for the handler
 * @returns Next.js POST handler function
 * 
 * @example
 * ```typescript
 * // /src/app/api/copilotkit/route.ts
 * import { createYaiNexusHandler } from "@yai-nexus/fekit";
 * 
 * export const POST = createYaiNexusHandler({
 *   backendUrl: process.env.PYTHON_BACKEND_URL!,
 * });
 * ```
 */
export function createYaiNexusHandler(options: CreateYaiNexusHandlerOptions) {
  // Create lightweight service adapter that proxies to AG-UI HttpAgent
  const serviceAdapter = new YaiNexusServiceAdapter(options.backendUrl);

  // Create CopilotRuntime
  const runtime = new CopilotRuntime({
    middleware: {
      onBeforeRequest: async ({ threadId, runId, inputMessages, properties }) => {
        if (options.logging?.enabled) {
          console.log('[YaiNexus] Request:', {
            threadId,
            runId,
            messageCount: inputMessages.length,
            properties
          });
        }
      },
      onAfterRequest: async ({ threadId, runId, inputMessages, outputMessages, properties }) => {
        if (options.logging?.enabled) {
          console.log('[YaiNexus] Response:', {
            threadId,
            runId,
            inputCount: inputMessages.length,
            outputCount: outputMessages.length,
            properties
          });
        }
      }
    }
  });

  // Create and return the Next.js POST handler
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter, // Use our lightweight adapter
    endpoint: "/api/copilotkit",
  });

  return async function POST(req: NextRequest) {
    try {
      return await handleRequest(req);
    } catch (error) {
      console.error('[YaiNexus] Handler error:', error);
      
      // Return a proper error response
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  };
}

/**
 * Type alias for the return type of createYaiNexusHandler
 */
export type YaiNexusHandler = ReturnType<typeof createYaiNexusHandler>;