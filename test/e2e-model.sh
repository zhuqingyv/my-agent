#!/bin/bash
# E2E Model Test — 用 curl 模拟 ma 的完整 agent loop
# 对着真实模型测试，验证 tool-use 多轮流程
set -e

API="${MA_API:-http://192.168.21.5:1234/v1}"
MODEL="${MA_MODEL:-qwen/qwen3.6-35b-a3b}"
PASS=0
FAIL=0

color_green='\033[32m'
color_red='\033[31m'
color_dim='\033[2m'
color_reset='\033[0m'

# 检查模型可用
echo "API: $API"
echo "Model: $MODEL"
MODELS=$(curl -s --connect-timeout 5 "$API/models" 2>&1)
if ! echo "$MODELS" | grep -q "$MODEL"; then
  echo -e "${color_red}SKIP: model $MODEL not available${color_reset}"
  exit 1
fi
echo ""

run_chat() {
  local messages="$1"
  local tools="$2"
  curl -s "$API/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$MODEL\",
      \"messages\": $messages,
      \"temperature\": 0.6,
      \"frequency_penalty\": 1.1
      $([ -n "$tools" ] && echo ", \"tools\": $tools, \"tool_choice\": \"auto\"")
    }" 2>&1
}

parse_response() {
  python3 -c "
import sys,json
d=json.loads(sys.stdin.read(), strict=False)
if 'error' in d:
    print('ERROR:' + d['error'][:200])
else:
    m=d['choices'][0]['message']
    c=m.get('content','') or ''
    tc=m.get('tool_calls') or []
    fr=d['choices'][0].get('finish_reason','')
    print(f'CONTENT_LEN:{len(c)}')
    print(f'TOOL_CALLS:{len(tc)}')
    print(f'FINISH:{fr}')
    if len(c) > 0: print(f'CONTENT:{c[:500]}')
    for t in tc:
        print(f'TOOL:{t[\"function\"][\"name\"]}|{t[\"function\"][\"arguments\"]}')
"
}

TOOLS='[
  {"type":"function","function":{"name":"fs__list_directory","description":"列出目录","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}},
  {"type":"function","function":{"name":"fs__read_file","description":"读文件","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}
]'

# ============================================================
# CASE 1: "这个项目怎么样？" — 完整 tool-use 到回答
# ============================================================
echo "=== CASE 1: 这个项目怎么样？ ==="

# Round 1: 用户提问
R1=$(run_chat '[
  {"role":"system","content":"你是助手。当前工作目录: /Users/zhuqingyu/project/supercell"},
  {"role":"user","content":"这个项目怎么样？"}
]' "$TOOLS")
R1P=$(echo "$R1" | parse_response)
echo -e "${color_dim}R1: $(echo "$R1P" | head -3)${color_reset}"

# 需要至少调一个工具
if ! echo "$R1P" | grep -q "TOOL_CALLS:[1-9]"; then
  echo -e "${color_red}FAIL: R1 should call tools${color_reset}"
  FAIL=$((FAIL+1))
else
  # Round 2: 传回 tool result
  R2=$(run_chat '[
    {"role":"system","content":"你是助手。"},
    {"role":"user","content":"这个项目怎么样？"},
    {"role":"assistant","content":"","tool_calls":[
      {"id":"c1","type":"function","function":{"name":"fs__list_directory","arguments":"{\"path\":\".\"}"}},
      {"id":"c2","type":"function","function":{"name":"fs__read_file","arguments":"{\"path\":\"./package.json\"}"}}
    ]},
    {"role":"tool","tool_call_id":"c1","content":"[file] package.json\n[file] README.md\n[dir] src/\n[dir] server/"},
    {"role":"tool","tool_call_id":"c2","content":"{\"name\":\"gagent\",\"dependencies\":{\"react\":\"19\",\"vite\":\"7\",\"zustand\":\"5\"}}"}
  ]' "$TOOLS")
  R2P=$(echo "$R2" | parse_response)
  echo -e "${color_dim}R2: $(echo "$R2P" | head -3)${color_reset}"

  # 可能继续调工具或直接回答
  R2_TC=$(echo "$R2P" | grep "TOOL_CALLS:" | cut -d: -f2)
  if [ "$R2_TC" = "0" ]; then
    # 直接回答
    R2_CL=$(echo "$R2P" | grep "CONTENT_LEN:" | cut -d: -f2)
    if [ "$R2_CL" -gt 50 ]; then
      echo -e "${color_green}PASS: case 1 — got answer ($R2_CL chars)${color_reset}"
      PASS=$((PASS+1))
    else
      echo -e "${color_red}FAIL: case 1 — answer too short ($R2_CL chars)${color_reset}"
      FAIL=$((FAIL+1))
    fi
  else
    # Round 3: 更多 tool results
    R3=$(run_chat '[
      {"role":"system","content":"你是助手。已收集足够信息，请总结回答。"},
      {"role":"user","content":"这个项目怎么样？"},
      {"role":"assistant","content":"","tool_calls":[
        {"id":"c1","type":"function","function":{"name":"fs__list_directory","arguments":"{\"path\":\".\"}"}},
        {"id":"c2","type":"function","function":{"name":"fs__read_file","arguments":"{\"path\":\"./package.json\"}"}}
      ]},
      {"role":"tool","tool_call_id":"c1","content":"[file] package.json\n[file] README.md\n[dir] src/\n[dir] server/"},
      {"role":"tool","tool_call_id":"c2","content":"{\"name\":\"gagent\",\"dependencies\":{\"react\":\"19\",\"vite\":\"7\"}}"},
      {"role":"assistant","content":"","tool_calls":[
        {"id":"c3","type":"function","function":{"name":"fs__read_file","arguments":"{\"path\":\"./README.md\"}"}}
      ]},
      {"role":"tool","tool_call_id":"c3","content":"# Supercell (gagent)\nLocal-first AI chat app.\n## Features\n- Multi-LLM\n- AI Review Team\n- Social graph"}
    ]' "$TOOLS")
    R3P=$(echo "$R3" | parse_response)
    R3_CL=$(echo "$R3P" | grep "CONTENT_LEN:" | cut -d: -f2)
    echo -e "${color_dim}R3: $(echo "$R3P" | head -3)${color_reset}"
    if [ "$R3_CL" -gt 50 ]; then
      echo -e "${color_green}PASS: case 1 — got answer in round 3 ($R3_CL chars)${color_reset}"
      PASS=$((PASS+1))
    else
      echo -e "${color_red}FAIL: case 1 — no answer after 3 rounds (content=$R3_CL)${color_reset}"
      FAIL=$((FAIL+1))
    fi
  fi
fi

echo ""

# ============================================================
# CASE 2: "这个项目是做什么的？" — 同上
# ============================================================
echo "=== CASE 2: 这个项目是做什么的？ ==="

R1=$(run_chat '[
  {"role":"system","content":"你是助手。当前工作目录: /Users/zhuqingyu/project/supercell"},
  {"role":"user","content":"这个项目是做什么的？"}
]' "$TOOLS")
R1P=$(echo "$R1" | parse_response)
echo -e "${color_dim}R1: $(echo "$R1P" | head -3)${color_reset}"

if ! echo "$R1P" | grep -q "TOOL_CALLS:[1-9]"; then
  # 直接回答了（不调工具）
  R1_CL=$(echo "$R1P" | grep "CONTENT_LEN:" | cut -d: -f2)
  if [ "$R1_CL" -gt 20 ]; then
    echo -e "${color_green}PASS: case 2 — direct answer ($R1_CL chars)${color_reset}"
    PASS=$((PASS+1))
  else
    echo -e "${color_red}FAIL: case 2 — empty answer${color_reset}"
    FAIL=$((FAIL+1))
  fi
else
  # 多轮
  R2=$(run_chat '[
    {"role":"system","content":"你是助手。已收集足够信息，请总结。"},
    {"role":"user","content":"这个项目是做什么的？"},
    {"role":"assistant","content":"","tool_calls":[
      {"id":"c1","type":"function","function":{"name":"fs__list_directory","arguments":"{\"path\":\".\"}"}},
      {"id":"c2","type":"function","function":{"name":"fs__read_file","arguments":"{\"path\":\"./package.json\"}"}}
    ]},
    {"role":"tool","tool_call_id":"c1","content":"[file] package.json\n[file] README.md\n[dir] src/"},
    {"role":"tool","tool_call_id":"c2","content":"{\"name\":\"gagent\",\"dependencies\":{\"react\":\"19\",\"vite\":\"7\"}}"},
    {"role":"assistant","content":"","tool_calls":[
      {"id":"c3","type":"function","function":{"name":"fs__read_file","arguments":"{\"path\":\"./README.md\"}"}}
    ]},
    {"role":"tool","tool_call_id":"c3","content":"# Supercell\nLocal-first AI chat app with agent orchestration."}
  ]' "$TOOLS")
  R2P=$(echo "$R2" | parse_response)
  R2_CL=$(echo "$R2P" | grep "CONTENT_LEN:" | cut -d: -f2)
  echo -e "${color_dim}R2: $(echo "$R2P" | head -3)${color_reset}"
  if [ "$R2_CL" -gt 50 ]; then
    echo -e "${color_green}PASS: case 2 — got answer ($R2_CL chars)${color_reset}"
    PASS=$((PASS+1))
  else
    echo -e "${color_red}FAIL: case 2 — no answer (content=$R2_CL)${color_reset}"
    FAIL=$((FAIL+1))
  fi
fi

echo ""
echo "=== Results: $PASS pass, $FAIL fail ==="
[ "$FAIL" -eq 0 ] || exit 1
