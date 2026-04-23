#!/bin/bash
# 端到端稳定性测试
# 用法: TEST_CWD=/path/to/project bash test/e2e.sh
#
# 说明:
#   - 用 expect 驱动 ma CLI 模拟真实交互
#   - 每个 case: 启动 ma -> 等 ❯ 提示符 -> 发送输入 -> 等"完成" -> /quit
#   - 捕获完整输出用于模式匹配（含 MaxListeners/HTML 泄露等横切检查）

PASS=0
FAIL=0
CWD=${TEST_CWD:-$(pwd)}
TIMEOUT_DEFAULT=${TIMEOUT_DEFAULT:-30}

# 运行单个 case，返回 ma 原始输出（含 ANSI）
# 参数: name input expect_pattern [timeout]
function run_test() {
  local name=$1
  local input=$2
  local expect_pattern=$3
  local timeout=${4:-$TIMEOUT_DEFAULT}

  printf "  [%-14s] " "$name"

  local output
  output=$(expect <<EXPECT 2>&1
set timeout $timeout
log_user 1
spawn bash -c "cd $CWD && ma"
expect {
  -re "❯|>" { }
  timeout { puts "\n<<TIMEOUT waiting for prompt>>"; exit 2 }
  eof { puts "\n<<EOF before prompt>>"; exit 3 }
}
send -- "$input\r"
expect {
  -re "完成" { }
  timeout { puts "\n<<TIMEOUT waiting for 完成>>"; }
  eof { puts "\n<<EOF before 完成>>"; }
}
# 给一点收尾时间让 ✱ 完成 行落盘
sleep 1
send -- "/quit\r"
expect {
  eof { }
  timeout { }
}
EXPECT
)

  # 横切检查: MaxListeners warning 视为额外红线
  local ml_leak=0
  if echo "$output" | grep -q "MaxListenersExceededWarning"; then
    ml_leak=1
  fi

  # HTML 泄露检查: 未渲染的 <p>/<pre>/<code> 等标签
  local html_leak=0
  if echo "$output" | grep -qE "<(p|pre|code|ul|ol|li|h[1-6])>"; then
    html_leak=1
  fi

  local ok=1
  if ! echo "$output" | grep -qE "$expect_pattern"; then
    ok=0
  fi

  # 特殊 case: no-html 要求 HTML 泄露为 0
  if [ "$name" = "no-html" ] && [ "$html_leak" = "1" ]; then
    ok=0
  fi
  # 特殊 case: no-maxlisteners 要求无 MaxListeners
  if [ "$name" = "no-maxlisteners" ] && [ "$ml_leak" = "1" ]; then
    ok=0
  fi

  if [ "$ok" = "1" ]; then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL (expected /$expect_pattern/, ml_leak=$ml_leak, html_leak=$html_leak)"
    if [ -n "$E2E_DEBUG" ]; then
      echo "---- output ----"
      echo "$output" | tail -40
      echo "----------------"
    fi
    FAIL=$((FAIL + 1))
  fi
}

echo "=== my-agent e2e tests ==="
echo "cwd: $CWD"
echo "ma:  $(command -v ma || echo MISSING)"
echo ""

if ! command -v ma >/dev/null 2>&1; then
  echo "ma 未找到，请先 npm link 或确保 bin 在 PATH"
  exit 1
fi
if ! command -v expect >/dev/null 2>&1; then
  echo "expect 未安装"
  exit 1
fi
if [ ! -d "$CWD" ]; then
  echo "TEST_CWD 目录不存在: $CWD"
  exit 1
fi

# 测试 1: 简单问答不调工具
run_test "simple-chat" "你好" "完成" 30

# 测试 2: 工具调用（列目录）
run_test "tool-call" "当前目录有什么文件" "完成" 45

# 测试 3: 无 HTML 泄露（让它介绍项目，输出可能含 markdown）
run_test "no-html" "介绍下这个项目" "完成" 60

# 测试 4: 无 MaxListeners warning（多轮或复杂任务时容易出现）
run_test "no-maxlisteners" "列出当前目录然后总结" "完成" 60

echo ""
echo "=== Results: $PASS pass, $FAIL fail ==="
exit $FAIL
