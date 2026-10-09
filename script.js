(() => {
  "use strict";

  /*
   * 高精度電卓
   * - 内部値は「BigIntの整数 + 小数桁数」で保持
   * - 通常の整数・小数の加減乗除で Number の精度制限を受けない
   * - 除算は DECIMAL_SCALE 桁まで計算
   * - 表示時に指数表記を一切使わない
   */

  const DECIMAL_SCALE = 100;       // 除算結果の最大小数桁
  const MAX_INPUT_DIGITS = 5000;   // 1数値あたりの入力上限

  const display = document.getElementById("display");
  const expression = document.getElementById("expression");
  const status = document.getElementById("status");
  const keys = document.getElementById("keys");

  let current = "0";
  let stored = null;
  let operator = null;
  let waitingForOperand = false;
  let lastOperator = null;
  let lastOperand = null;
  let justEvaluated = false;
  let errorState = false;

  // -----------------------------
  // Decimal BigInt representation
  // value = integer * 10^-scale
  // -----------------------------

  function normalize(v) {
    let { i, s } = v;

    if (i === 0n) return { i: 0n, s: 0 };

    while (s > 0 && i % 10n === 0n) {
      i /= 10n;
      s--;
    }
    return { i, s };
  }

  function parseDecimal(text) {
    text = String(text).trim();
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      throw new Error("invalid number");
    }

    let sign = "";
    if (text[0] === "-") {
      sign = "-";
      text = text.slice(1);
    }

    const parts = text.split(".");
    const whole = parts[0] || "0";
    const frac = parts[1] || "";
    const digits = (whole + frac).replace(/^0+(?=\d)/, "") || "0";

    let i = BigInt((sign === "-" ? "-" : "") + digits);
    return normalize({ i, s: frac.length });
  }

  function align(a, b) {
    const s = Math.max(a.s, b.s);
    return {
      ai: a.i * 10n ** BigInt(s - a.s),
      bi: b.i * 10n ** BigInt(s - b.s),
      s
    };
  }

  function add(a, b) {
    const x = align(a, b);
    return normalize({ i: x.ai + x.bi, s: x.s });
  }

  function sub(a, b) {
    const x = align(a, b);
    return normalize({ i: x.ai - x.bi, s: x.s });
  }

  function mul(a, b) {
    return normalize({ i: a.i * b.i, s: a.s + b.s });
  }

  function div(a, b) {
    if (b.i === 0n) throw new Error("DIV_ZERO");

    // a.i / 10^a.s ÷ b.i / 10^b.s
    // scale extra digits so that the result has DECIMAL_SCALE decimal places.
    const extra = BigInt(Math.max(0, DECIMAL_SCALE + b.s - a.s));
    let numerator = a.i * 10n ** extra;
    let quotient = numerator / b.i;

    // 四捨五入
    const remainder = numerator % b.i;
    if (remainder !== 0n && (remainder < 0n) !== (b.i < 0n)) {
      // handled below using absolute values
    }

    const absR = remainder < 0n ? -remainder : remainder;
    const absD = b.i < 0n ? -b.i : b.i;
    if (absR * 2n >= absD) {
      quotient += (a.i < 0n) === (b.i < 0n) ? 1n : -1n;
    }

    return normalize({ i: quotient, s: Number(extra) + b.s - a.s });
  }

  function neg(a) {
    return { i: -a.i, s: a.s };
  }

  function formatDecimal(v) {
    v = normalize(v);
    if (v.i === 0n) return "0";

    const negative = v.i < 0n;
    let digits = (negative ? -v.i : v.i).toString();

    if (v.s === 0) {
      return (negative ? "-" : "") + addGrouping(digits);
    }

    if (digits.length <= v.s) {
      digits = "0".repeat(v.s - digits.length + 1) + digits;
    }

    const pos = digits.length - v.s;
    let out = digits.slice(0, pos) + "." + digits.slice(pos);

    // normalize already removed trailing zeros, but keep this safe.
    out = out.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    const [whole, frac] = out.split(".");
    return (negative ? "-" : "") +
      addGrouping(whole) +
      (frac !== undefined ? "." + frac : "");
  }

  function addGrouping(s) {
    // Group only when useful; for huge values grouping is still readable.
    let result = "";
    for (let i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) result += ",";
      result += s[i];
    }
    return result;
  }

  function rawFormat(v) {
    return formatDecimal(v);
  }

  function currentValue() {
    return parseDecimal(current);
  }

  function setCurrentFromValue(v) {
    const text = formatDecimal(v).replace(/,/g, "");
    current = text;
  }

  function calculate(aText, op, bText) {
    const a = parseDecimal(aText);
    const b = parseDecimal(bText);

    switch (op) {
      case "+": return add(a, b);
      case "−": return sub(a, b);
      case "×": return mul(a, b);
      case "÷": return div(a, b);
      default: throw new Error("UNKNOWN_OPERATOR");
    }
  }

  // -----------------------------
  // UI
  // -----------------------------

  function shownCurrent() {
    try {
      return rawFormat(currentValue());
    } catch {
      return current;
    }
  }

  function updateDisplay() {
    display.textContent = errorState ? "Error" : shownCurrent();

    if (stored !== null && operator) {
      expression.textContent = `${rawFormat(parseDecimal(stored))} ${operator}`;
    } else if (justEvaluated && lastOperator && lastOperand !== null) {
      expression.textContent =
        `${rawFormat(currentValue())} ${lastOperator} ${rawFormat(parseDecimal(lastOperand))} =`;
    } else {
      expression.textContent = "";
    }

    status.textContent =
      errorState ? "ACでリセットしてください" :
      `${current.replace("-", "").replace(".", "").length.toLocaleString()} 桁`;
  }

  function reset() {
    current = "0";
    stored = null;
    operator = null;
    waitingForOperand = false;
    lastOperator = null;
    lastOperand = null;
    justEvaluated = false;
    errorState = false;
    updateDisplay();
  }

  function appendDigit(digit) {
    if (errorState) reset();

    if (justEvaluated) {
      current = digit;
      justEvaluated = false;
      lastOperator = null;
      lastOperand = null;
      updateDisplay();
      return;
    }

    if (waitingForOperand) {
      current = digit;
      waitingForOperand = false;
      updateDisplay();
      return;
    }

    if (current === "0") {
      current = digit;
    } else if (current === "-0") {
      current = "-" + digit;
    } else {
      const digitCount = current.replace(/[-.]/g, "").length;
      if (digitCount < MAX_INPUT_DIGITS) current += digit;
    }

    updateDisplay();
  }

  function appendDecimal() {
    if (errorState) reset();

    if (justEvaluated || waitingForOperand) {
      current = "0.";
      justEvaluated = false;
      waitingForOperand = false;
      updateDisplay();
      return;
    }

    if (!current.includes(".")) current += ".";
    updateDisplay();
  }

  function toggleSign() {
    if (errorState) return;
    if (current === "0") return;
    current = current.startsWith("-") ? current.slice(1) : "-" + current;
    updateDisplay();
  }

  function backspace() {
    if (errorState) {
      reset();
      return;
    }

    if (justEvaluated) return;

    if (waitingForOperand) return;

    current = current.length > 1 ? current.slice(0, -1) : "0";
    if (current === "-" || current === "") current = "0";
    updateDisplay();
  }

  function percent() {
    if (errorState) return;

    try {
      const value = div(currentValue(), parseDecimal("100"));
      setCurrentFromValue(value);
      justEvaluated = false;
      updateDisplay();
    } catch {
      setError();
    }
  }

  function chooseOperator(nextOperator) {
    if (errorState) reset();

    try {
      if (justEvaluated) {
        stored = current;
        justEvaluated = false;
      } else if (operator && !waitingForOperand) {
        const result = calculate(stored, operator, current);
        setCurrentFromValue(result);
        stored = current;
      } else {
        stored = current;
      }

      operator = nextOperator;
      waitingForOperand = true;
      updateDisplay();
    } catch {
      setError();
    }
  }

  function equals() {
    if (errorState) return;

    try {
      // 「=」連打：
      // 2 + 3 = → 5
      // =       → 8
      // =       → 11
      if (operator && stored !== null) {
        const operand = waitingForOperand ? stored : current;
        const result = calculate(stored, operator, operand);

        lastOperator = operator;
        lastOperand = operand;
        setCurrentFromValue(result);

        stored = null;
        operator = null;
        waitingForOperand = false;
        justEvaluated = true;
        updateDisplay();
        return;
      }

      if (justEvaluated && lastOperator !== null && lastOperand !== null) {
        const result = calculate(current, lastOperator, lastOperand);
        setCurrentFromValue(result);
        updateDisplay();
      }
    } catch (e) {
      setError(e.message);
    }
  }

  function setError() {
    errorState = true;
    updateDisplay();
  }

  // -----------------------------
  // Events
  // -----------------------------

  keys.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.digit !== undefined) {
      appendDigit(button.dataset.digit);
      return;
    }

    const action = button.dataset.action;
    if (action === "clear") reset();
    else if (action === "backspace") backspace();
    else if (action === "decimal") appendDecimal();
    else if (action === "percent") percent();
    else if (action === "operator") chooseOperator(button.dataset.value);
    else if (action === "equals") equals();
  });

  // Touch-specific handling:
  // touch-action: manipulation + click delegation prevents the classic
  // mobile double-tap zoom problem without manually firing duplicate clicks.
  keys.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("button");
    if (button) button.classList.add("pressed");
  });

  keys.addEventListener("pointerup", (event) => {
    const button = event.target.closest("button");
    if (button) button.classList.remove("pressed");
  });

  keys.addEventListener("pointercancel", (event) => {
    const button = event.target.closest("button");
    if (button) button.classList.remove("pressed");
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;

    if (/^\d$/.test(key)) {
      event.preventDefault();
      appendDigit(key);
    } else if (key === "." || key === ",") {
      event.preventDefault();
      appendDecimal();
    } else if (key === "+") {
      event.preventDefault();
      chooseOperator("+");
    } else if (key === "-") {
      event.preventDefault();
      chooseOperator("−");
    } else if (key === "*" || key === "x" || key === "X") {
      event.preventDefault();
      chooseOperator("×");
    } else if (key === "/") {
      event.preventDefault();
      chooseOperator("÷");
    } else if (key === "Enter" || key === "=") {
      event.preventDefault();
      equals();
    } else if (key === "Backspace") {
      event.preventDefault();
      backspace();
    } else if (key === "Escape" || key === "Delete") {
      event.preventDefault();
      reset();
    } else if (key === "%") {
      event.preventDefault();
      percent();
    }
  });

  // Prevent accidental text selection by drag/touch.
  document.addEventListener("selectstart", (event) => {
    if (event.target.closest(".calculator")) event.preventDefault();
  });

  // iOS Safari's gesture handling.
  document.addEventListener("gesturestart", (event) => event.preventDefault());
  document.addEventListener("gesturechange", (event) => event.preventDefault());
  document.addEventListener("gestureend", (event) => event.preventDefault());

  updateDisplay();
})();
