// Reads dependency specifiers through the owning JavaScript, Svelte and CSS parsers
import { isBuiltin } from 'node:module';
import { extname } from 'node:path';
import postcss from 'postcss';
import { parse } from 'svelte/compiler';
import ts from 'typescript';

export function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('$') || specifier.startsWith('/') ||
      specifier.includes('://') || isBuiltin(specifier)) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function importedPackages(source, filename = 'module.ts') {
  const specifiers = [];
  const extension = extname(filename);
  if (extension === '.css') {
    visitCss(source, filename, specifiers);
  } else if (extension === '.svelte') {
    const component = parse(source, { filename, modern: true });
    visitSvelte(component, specifiers);
    if (component.css) visitCss(source.slice(component.css.content.start, component.css.content.end), filename, specifiers);
  } else {
    visitScript(ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false), specifiers);
  }
  return specifiers.map(packageName).filter(Boolean);
}

function visitCss(source, filename, specifiers) {
  postcss.parse(source, { from: filename }).walkAtRules('import', rule => {
    const match = /^(?:url\(\s*)?['"]([^'"]+)['"]/.exec(rule.params);
    if (match) specifiers.push(match[1]);
  });
}

function visitScript(node, specifiers) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    specifiers.push(node.moduleSpecifier.text);
  } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
    specifiers.push(node.moduleReference.expression.text);
  } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
    specifiers.push(node.arguments[0].text);
  }
  ts.forEachChild(node, child => visitScript(child, specifiers));
}

function visitSvelte(node, specifiers) {
  if (!node || typeof node !== 'object') return;
  let source;
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
    source = node.source;
  } else if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') {
    source = node.arguments[0];
  }
  if (typeof source?.value === 'string') specifiers.push(source.value);
  else if (source?.type === 'TemplateLiteral' && !source.expressions.length) specifiers.push(source.quasis[0].value.cooked);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(value => visitSvelte(value, specifiers));
    else if (child && typeof child === 'object') visitSvelte(child, specifiers);
  }
}
