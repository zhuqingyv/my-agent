import React, { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Box, useApp, useInput } from 'ink';
import type { AgentConfig, McpConnection, Agent } from '../mcp/types.js';
import { createUiStore } from './state/store.js';
import { useAgent } from './hooks/useAgent.js';
import { useDebugLog } from './hooks/useDebugLog.js';
import { Banner } from './components/Banner.js';
import { ChatHistory } from './components/ChatHistory.js';
import { Markdown } from './components/Markdown.js';
import { ThinkingBar } from './components/ThinkingBar.js';
import { InputBox } from './components/InputBox.js';
import { StatusBar } from './components/StatusBar.js';
import { isCommand, executeCommand } from './utils/commands.js';

export interface AppProps {
  config: AgentConfig;
  connections: McpConnection[];
  agent: Agent;
  debug?: boolean;
}

let sysMsgCounter = 0;
function nextSysId() {
  return `sys_${++sysMsgCounter}`;
}

export function App({ config, connections, agent, debug }: AppProps) {
  const app = useApp();
  const store = useMemo(() => {
    const s = createUiStore();
    const mcpStr = connections.map(c => `${c.name}(${c.tools.length})`).join(', ') || '(none)';
    s.pushMessage({
      kind: 'system',
      id: 'banner',
      text: `  MA  v1.0.0\n  model: ${config.model.model}  ${config.model.baseURL}\n  mcp:   ${mcpStr}`,
    });
    return s;
  }, []);
  const { send, abort } = useAgent(agent, store);
  const log = useDebugLog(!!debug);

  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { messages, thinking, inFlightText } = state;

  const handleSubmit = useCallback(
    (text: string) => {
      log(`submit: ${text}`);
      if (isCommand(text)) {
        const result = executeCommand(text, {
          agent,
          connections,
          exit: () => app.exit(),
        });
        if (text === '/clear') {
          store.clearMessages();
        }
        if (result !== null) {
          store.pushMessage({ kind: 'system', id: nextSysId(), text: result });
        }
        return;
      }
      send(text);
    },
    [agent, connections, app, store, send, log]
  );

  useInput((_input, key) => {
    if (key.escape && thinking) {
      log('abort via ESC');
      abort();
    }
  });

  const mcpList = connections.map((c) => ({
    name: c.name,
    toolCount: c.tools.length,
  }));

  const taskStack = agent.getTaskStack();
  const taskCount = taskStack.pending().length + (taskStack.current() ? 1 : 0);

  return (
    <Box flexDirection="column">
      <ChatHistory messages={messages} />

      {inFlightText ? (
        <Box marginTop={1}>
          <Markdown source={inFlightText} />
        </Box>
      ) : null}

      {thinking ? (
        <ThinkingBar event={thinking.event} startedAt={thinking.startedAt} />
      ) : null}

      <InputBox onSubmit={handleSubmit} disabled={!!thinking} />

      <StatusBar
        model={config.model.model}
        taskCount={taskCount}
        debug={debug}
      />
    </Box>
  );
}
