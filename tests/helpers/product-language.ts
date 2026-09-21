import ts from "typescript";

export const PRODUCT_LANGUAGE_ALLOWED = ["RivalHub", "Major", "Rivals", "Stage 1", "Stage 2", "Stage 3", "Playoff", "BO1", "BO3", "BO5", "Steam64", "Steam", "5E", "Perfect World", "Rating Pro", "Rating+", "MVP", "EVP", "Pick'Em"] as const;
const internalVocabulary = /\b(?:CompetitionEntry|EventRoster|Entry|revision|snapshot|canonical|owner|evaluator|registrationConfig|ConversionPolicy|mapping|policy|fallback|migration|schema|sourceSelection|stable ID|approved|roster|eligibility|qualification|minStar|maxStar|targetStarFloor|slopeNum|slopeDen|fail[ -]?closed|preflight|blocker|StageRun|credential|provenance|primary login identity|secondary (?:email )?identity|verified email identity|draft pick|captain vote)\b/i;

const machineSemanticProperties = new Set(["status", "kind", "type", "source", "mode", "state", "domain"]);

export function internalProductVocabulary(text: string): string | null {
  const normal = PRODUCT_LANGUAGE_ALLOWED.reduce((value, brand) => value.replaceAll(brand, ""), text);
  return normal.match(internalVocabulary)?.[0] ?? null;
}

const visibleAttributes = new Set(["label", "title", "sub", "description", "placeholder", "alt", "aria-label", "confirmLabel", "eyebrow"]);
const visibleProperties = new Set(["label", "title", "sub", "detail", "description", "message"]);

export interface ProductLanguageOptions {
  /** Restrict the scan to non-INTERNAL AppError messages. */
  expectedErrorsOnly?: boolean;
}

function unwrapExpression(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function machinePropertyName(node: ts.Node): string | null {
  const expression = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
}

function isMachineSemanticAccess(node: ts.Node): boolean {
  const name = machinePropertyName(node);
  return name !== null && machineSemanticProperties.has(name);
}

function isVisiblePresentationPosition(node: ts.Node): boolean {
  let current = node;
  for (let parent: ts.Node | undefined = current.parent; parent; parent = current.parent) {
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent)
    ) {
      current = parent;
      continue;
    }
    if (ts.isTemplateSpan(parent)) {
      current = parent.parent;
      continue;
    }
    if (ts.isTemplateExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isJsxExpression(parent)) {
      const container = parent.parent;
      if (ts.isJsxAttribute(container)) return ts.isIdentifier(container.name) && visibleAttributes.has(container.name.text);
      if (ts.isJsxElement(container) || ts.isJsxSelfClosingElement(container)) return true;
    }
    return false;
  }
  return false;
}

function isRawFallback(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;
  if (node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken && node.operatorToken.kind !== ts.SyntaxKind.BarBarToken) return false;
  const right = unwrapExpression(node.right);
  const left = unwrapExpression(node.left);
  if (!isMachineSemanticAccess(right) || !ts.isElementAccessExpression(left) || !left.argumentExpression) return false;
  return isMachineSemanticAccess(left.argumentExpression);
}

function isWithinExpectedAppError(node: ts.Node, source: ts.SourceFile): { internal: boolean } | null {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (!ts.isNewExpression(current) || current.expression.getText(source) !== "AppError") continue;
    const message = current.arguments?.[1];
    if (!message || node.getStart(source) < message.getStart(source) || node.getEnd() > message.getEnd()) return null;
    return { internal: current.arguments?.[0]?.getText(source).replace(/\s/g, "") === "ErrorCode.INTERNAL_ERROR" };
  }
  return null;
}

function isStringLiteralLike(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
}

function isWithPresentationCall(node: ts.Node, source: ts.SourceFile): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  return node.expression.expression.getText(source) === "AppError" && node.expression.name.text === "withPresentation";
}

function expectedPresentationTextStarts(source: ts.SourceFile): Set<number> {
  const starts = new Set<number>();
  const declarations = new Map<string, ts.VariableDeclaration[]>();
  let hasPresentationOwner = false;

  function collectDeclarations(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const current = declarations.get(node.name.text) ?? [];
      current.push(node);
      declarations.set(node.name.text, current);
    }
    ts.forEachChild(node, collectDeclarations);
  }
  collectDeclarations(source);

  const visitedDeclarations = new Set<ts.VariableDeclaration>();
  function collectMessageExpression(node: ts.Node): void {
    const expression = unwrapExpression(node);
    if (isStringLiteralLike(expression)) {
      starts.add(expression.getStart(source));
      return;
    }
    if (ts.isIdentifier(expression)) {
      for (const declaration of declarations.get(expression.text) ?? []) {
        if (visitedDeclarations.has(declaration) || !declaration.initializer) continue;
        visitedDeclarations.add(declaration);
        collectMessageExpression(declaration.initializer);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      collectMessageExpression(expression.expression);
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) collectMessageExpression(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) collectMessageExpression(property.name);
      }
      return;
    }
    ts.forEachChild(expression, collectMessageExpression);
  }

  function visit(node: ts.Node) {
    if (isWithPresentationCall(node, source)) {
      hasPresentationOwner = true;
      const presentation = node.arguments[1];
      if (presentation && ts.isObjectLiteralExpression(presentation)) {
        const message = presentation.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && property.name.getText(source) === "message",
        );
        if (message) collectMessageExpression(message.initializer);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  // Canonical presentation owners keep their copy in an exhaustive MESSAGES
  // map. Collect the values even when the call reaches the map indirectly
  // through a formatter, so a new owner cannot bypass the gate.
  if (hasPresentationOwner) {
    for (const declaration of declarations.get("MESSAGES") ?? []) {
      if (declaration.initializer) collectMessageExpression(declaration.initializer);
    }
  }
  return starts;
}

/** Literal and AST presentation text are checked; identifiers and comments are not. */
export function productLanguageViolations(path: string, text: string, options: ProductLanguageOptions = {}): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const localVisibleCallArguments = new Map<string, Set<number>>();

  function collectVisibleCallArguments(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const indexes = new Set<number>();
      node.parameters.forEach((parameter, index) => {
        if (ts.isIdentifier(parameter.name) && visibleProperties.has(parameter.name.text)) indexes.add(index);
      });
      if (indexes.size > 0) localVisibleCallArguments.set(node.name.text, indexes);
    }
    ts.forEachChild(node, collectVisibleCallArguments);
  }
  collectVisibleCallArguments(source);
  const rawFallbackRightStarts = new Set<number>();
  const expectedPresentationStarts = options.expectedErrorsOnly ? expectedPresentationTextStarts(source) : new Set<number>();
  const reported = new Set<string>();

  function report(node: ts.Node, message: string) {
    const key = `${node.getStart(source)}:${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  }

  function visible(node: ts.Node, value: string): boolean {
    if (expectedPresentationStarts.has(node.getStart(source))) return true;
    // Internal failures are logged; actionError exposes only the generic message.
    const appError = isWithinExpectedAppError(node, source);
    if (appError?.internal) return false;
    if (appError) return true;
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isNewExpression(parent) && parent.expression.getText(source) === "AppError" && parent.arguments?.[0]?.getText(source) === "ErrorCode.INTERNAL_ERROR") return false;
      if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "details" && !parent.openingElement.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "open")) return false;
      if (ts.isJsxAttribute(parent)) return visibleAttributes.has(parent.name.getText(source));
      if (ts.isCallExpression(parent)) {
        if (ts.isIdentifier(parent.expression)) {
          const visibleIndexes = localVisibleCallArguments.get(parent.expression.text);
          if (visibleIndexes) {
            const argumentIndex = parent.arguments.findIndex(
              (argument) => node.getStart(source) >= argument.getStart(source) && node.getEnd() <= argument.getEnd(),
            );
            if (argumentIndex >= 0 && visibleIndexes.has(argumentIndex)) return true;
          }
        }
        return false;
      }
      if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)) return false;
      if (ts.isPropertyAssignment(parent) && visibleProperties.has(parent.name.getText(source))) return true;
      if (ts.isJsxExpression(parent) || ts.isJsxText(node)) return true;
    }
    return /[\u3400-\u9fff]/.test(value);
  }
  function visit(node: ts.Node) {
    if (!options.expectedErrorsOnly && isRawFallback(node) && isVisiblePresentationPosition(node)) {
      const right = ts.isBinaryExpression(node) ? unwrapExpression(node.right) : null;
      if (right) rawFallbackRightStarts.add(right.getStart(source));
      report(node, `raw machine-value fallback: ${node.getText(source)}`);
    }
    const machineAccessNode = (ts.isPropertyAccessExpression(node) && machineSemanticProperties.has(node.name.text))
      || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && machineSemanticProperties.has(node.argumentExpression.text));
    if (!options.expectedErrorsOnly && machineAccessNode && isVisiblePresentationPosition(node) && !rawFallbackRightStarts.has(node.getStart(source))) {
      report(node, `direct machine-value render: ${node.getText(source)}`);
    }
    if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (options.expectedErrorsOnly && !isWithinExpectedAppError(node, source) && !expectedPresentationStarts.has(node.getStart(source))) {
        ts.forEachChild(node, visit);
        return;
      }
      const word = internalProductVocabulary(node.text);
      if (word && visible(node, node.text)) report(node, node.text.trim());
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}
