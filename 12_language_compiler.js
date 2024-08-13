"use strict"

const DO_LOG = false;
const indent_char = "    ";

function parseExpression(program) {
  program = skipSpace(program);
  let match, expr;
  if (match = /^"([^"]*)"/.exec(program)) {
    expr = {type: "value", value: match[1]};
  } else if (match = /^\d+\b/.exec(program)) {
    expr = {type: "value", value: Number(match[0])};
  } else if (match = /^[^\s(),#"]+/.exec(program)) {
    expr = {type: "word", name: match[0]};
  } else {
    throw new SyntaxError("Unexpected syntax: " + program);
  }

  return parseApply(expr, program.slice(match[0].length));
}

function skipSpace(string) {
  let skippable = string.match(/^(\s|#.*)*/);
  return string.slice(skippable[0].length);
}

function parseApply(expr, program) {
  program = skipSpace(program);
  if (program[0] != "(") {
    return {expr: expr, rest: program};
  }

  program = skipSpace(program.slice(1));
  expr = {type: "apply", operator: expr, args: []};
  while (program[0] != ")") {
    let arg = parseExpression(program);
    expr.args.push(arg.expr);
    program = skipSpace(arg.rest);
    if (program[0] == ",") {
      program = skipSpace(program.slice(1));
    } else if (program[0] != ")") {
      throw new SyntaxError(`Expected ',' or ')' at ${program}`);
    }
  }
  return parseApply(expr, program.slice(1));
}

function parse(program) {
  let {expr, rest} = parseExpression(program);
  if (skipSpace(rest).length > 0) {
    throw new SyntaxError("Unexpected text after program");
  }
  return expr;
}
//    operator: {type: "word", name: "+"},
//    args: [{type: "word", name: "a"},
//           {type: "value", value: 10}]}

var specialForms = Object.create(null);

function evaluate(expr, scope, meta) {
  if (expr.type == "value") {
    //let value = expr.value;
    let value = JSON.stringify(expr.value);
    return evaluate_meta(value, meta);
  } else if (expr.type == "word") {
    if (expr.name in scope) {
      let value = scope[expr.name];
      return evaluate_meta(value, meta);
    } else {
      throw new ReferenceError(
        `Undefined binding: ${expr.name}`);
    }
  } else if (expr.type == "apply") {
    let {operator, args} = expr;
    if (operator.type == "word" &&
        operator.name in specialForms) {
      return specialForms[operator.name](expr.args, scope, meta);
    } 
    else {
      let op = evaluate(operator, scope);
      if (typeof op == "function") {
        return op(...args.map(arg => evaluate(arg, scope)), meta);
      } else {
        return function_expression(operator, args, scope, meta);
      }
    }
  }
}

specialForms.if = (args, scope, meta) => {
  if (args.length != 3) {
    throw new SyntaxError("Wrong number of args to if");
  }
  let arg0 = evaluate(args[0], scope);
  let arg1 = evaluate(args[1], scope, {last: default_meta(meta).last, semicolon: default_meta(meta).semicolon, indent: true});
  let arg2 = evaluate(args[2], scope, {last: default_meta(meta).last, semicolon: default_meta(meta).semicolon, indent: true});
  let stmt = 
  `if (${arg0}) {\n` +
  `${arg1}\n` +
  `} else {\n` +
  `${arg2}\n` +
  `}`;
  stmt = evaluate_meta(stmt, {indent: default_meta(meta).indent})
  if (DO_LOG) console.log(`if: ${stmt}`);
  return stmt;
};

specialForms.while = (args, scope, meta) => {
  if (args.length != 2) {
    throw new SyntaxError("Wrong number of args to while");
  }
  let arg0 = evaluate(args[0], scope);
  let arg1 = evaluate(args[1], scope, {last: default_meta(meta).last, semicolon: default_meta(meta).semicolon, indent: true});
  let stmt = 
  `while (${arg0}) {\n` +
  `${arg1}\n` +
  `}`;
  stmt = evaluate_meta(stmt, {indent: default_meta(meta).indent})
  if (DO_LOG) console.log(`while: ${stmt}`);
  return stmt;
};

specialForms.for = (args, scope, meta) => {
  if (args.length != 4) {
    throw new SyntaxError("Wrong number of args to for");
  }
  let arg0 = evaluate(args[0], scope);
  let arg1 = evaluate(args[1], scope);
  let arg2 = evaluate(args[2], scope);
  let arg3 = evaluate(args[3], scope, {last: default_meta(meta).last, semicolon: default_meta(meta).semicolon, indent: true});
  let stmt = 
  `for (${arg0}; ${arg1}; ${arg2}) {\n` + 
  `${arg3}\n` +
  `}`;
  stmt = evaluate_meta(stmt, {indent: default_meta(meta).indent})
  if (DO_LOG) console.log(`for: ${stmt}`);
  return stmt;
};

specialForms.do = (args, scope, meta) => {
  let stmts = [];
  for (let i = 0; i < args.length; i++) {
    let stmt;
    if (i == args.length - 1 && default_meta(meta).last) {
      stmt = `${evaluate(args[i], scope, {last: default_meta(meta).last, semicolon: true, indent: default_meta(meta).indent})}`;
    } else {
      stmt = `${evaluate(args[i], scope, {semicolon: true, indent: default_meta(meta).indent})}`;
    }
    if (DO_LOG) console.log(`do stmt: ${stmt}`);
    stmts.push(stmt);
  }
  let joined_stmts = stmts.join('\n');
  if (DO_LOG) console.log(`do stmts: ${joined_stmts}`);
  return joined_stmts;
};

specialForms.define = (args, scope, meta) => {
  if (args.length != 2 || args[0].type != "word") {
    throw new SyntaxError("Incorrect use of define");
  }
  let arg0 = args[0].name;
  let inscope = false;
  if (args[0].name in scope[local]) {
    inscope = true;
  }
  scope[args[0].name] = arg0;
  let arg1 = evaluate(args[1], scope);

  let stmt =  `${arg0} = ${arg1}`;
  if (DO_LOG) console.log(`define: ${stmt}`);
  if (!inscope) {
    stmt = `let ` + stmt;
    scope[local][args[0].name] = arg0;
  } 
  stmt = evaluate_meta(stmt, {semicolon: default_meta(meta).semicolon, indent: default_meta(meta).indent});
  return stmt;
};

// Define without use of local trick
specialForms.set = (args, scope, meta) => {
  if (args.length != 2 || args[0].type != "word") {
    throw new SyntaxError("Incorrect use of set");
  }
  let arg0 = args[0].name;
  let inscope = false;
  if (!(args[0].name in scope)) {
    throw new ReferenceError(`Setting undefined variable ${arg0}`)
  }
  scope[args[0].name] = arg0;
  let arg1 = evaluate(args[1], scope);

  let stmt =  `${arg0} = ${arg1}`;
  stmt = evaluate_meta(stmt, {semicolon: default_meta(meta).semicolon, indent: default_meta(meta).indent});
  if (DO_LOG) console.log(`set: ${stmt}`);
  return stmt;
};

specialForms.native = (args, _, meta) => {
  let stmt = JSON.parse(evaluate(args[0]));
  let skip_length = 0;
  let stmt_array = stmt.split('\n').filter(l => /^\s*(?=\S)/.test(l));
  skip_length = stmt_array[0].match(/^\s*(?=\S)/)[0].length;
  stmt = stmt_array.map(s => {
    return s.slice(skip_length);
  }).join('\n');
  stmt = evaluate_meta(stmt, {indent: default_meta(meta).indent});
  return stmt;
}

specialForms.extern = (args, scope) => {
  if (args.length != 1 || args[0].type != "word") {
    throw new SyntaxError("Incorrect use of extern");
  }
  let arg0 = args[0].name;
  let inscope = false;
  if (args[0].name in scope[local]) {
    inscope = true;
  }
  scope[args[0].name] = arg0;

  let stmt =  `//External label: ${arg0}`;
  if (DO_LOG) console.log(`extern: ${stmt}`);
  if (!inscope) {
    scope[local][args[0].name] = arg0;
  } 
  return stmt;
}

var topScope = Object.create(null);

topScope.true = `true`;
topScope.false = `false`;

for (let op of ["+", "-", "*", "/", "==", "<", ">", "<=", ">="]) {
    topScope[op] = Function("a, b, meta", 
    `
      let stmt = a + " ${op} " + b;
      stmt = evaluate_meta(stmt, meta);
      return stmt;
    `
  );
}

topScope.print = (value, meta) => {
  let stmt = `console.log(${value})`;
  stmt = evaluate_meta(stmt, {semicolon: default_meta(meta).semicolon, indent: default_meta(meta).indent});
  return stmt;
}

topScope.array = (...values) => {
  let meta = values.pop();
  let stmt = `[${values}]`;
  stmt = evaluate_meta(stmt, meta);
  return stmt;
}

topScope.length = (array, meta) => {
  let stmt = `${array}.length`;
  stmt = evaluate_meta(stmt, meta);
  return stmt;
}

topScope.element = (array, i, meta) => {
  let stmt = `${array}[${i}]`;
  stmt = evaluate_meta(stmt, meta);
  return stmt;
}

topScope.push = (array, val, meta) => {
  let stmt = `${array}.push(${val})`;
  stmt = evaluate_meta(stmt, meta);
  return stmt;
}

// Used to simulate the original Egg language.
// The symbols that are local to this function are kept track
// so that they may be redefined if declared in a scope.
let local = Symbol.for("local");
topScope[local] = {};

function run(program) {
  return Function("", '"use strict"\n' + compile(program))();
}

function compile(program) {
  topScope[local] = {};
  let progstring = evaluate(parse(program), Object.create(topScope), {last: true, semicolon: true, indent: false});
  return progstring;
}

specialForms.fun = (args, scope, meta) => {
  if (!args.length) {
    throw new SyntaxError("Functions need a body");
  }
  let body = args[args.length - 1];
  let params = args.slice(0, args.length - 1).map(expr => {
    if (expr.type != "word") {
      throw new SyntaxError("Parameter names must be words");
    }
    return expr.name;
  });
  let localScope = Object.create(scope);
  localScope[local] = {};
  for (let i = 0; i < params.length; i++) {
    localScope[params[i]] = params[i];
    localScope[local][params[i]] = params[i];
  }
  let stmt = 
  `function(${params}) {\n` +
  `${evaluate(body, localScope, {last: true, semicolon: true, indent: true})}\n` +
  `}`;
  stmt = evaluate_meta(stmt, {semicolon: default_meta(meta).semicolon, indent: default_meta(meta).indent})
  return stmt;
};

function function_expression(operator, args, scope, meta) {
  let stmt = `${evaluate(operator, scope)}(${args.map(arg => evaluate(arg, scope))})`
  stmt = evaluate_meta(stmt, meta);
  return stmt;
}

// meta = {
//   last: "Is this the last statement of its block" 
//   semicolon: "Does this statement end in a semicolon"
//   indent: "Is this statement indented"
// }
function default_meta(meta) {
  meta ??= {last: false, semicolon: false};
  meta.last ??= false;
  meta.semicolon ??= false;
  meta.indent ??= false;
  return meta
}

function evaluate_meta(stmt, meta) {
  let def_meta = default_meta(meta);
  if (def_meta.last) {
    stmt = "return " + stmt;
  }
  if (def_meta.semicolon) {
    stmt = stmt + ";";
  }
  if (def_meta.indent) {
    let temp = '';
    stmt.split('\n').forEach(function(line, index, array){
        if (index == array.length - 1) {
          temp += indent_char + line;
        } else {
          temp += indent_char + line + '\n';
        }
    });
    stmt = temp;
  }
  return stmt;
}
