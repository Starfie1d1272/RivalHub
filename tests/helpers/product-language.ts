import ts from "typescript";

export const PRODUCT_LANGUAGE_ALLOWED = ["RivalHub", "Major", "Rivals", "Stage 1", "Stage 2", "Stage 3", "Playoff", "BO1", "BO3", "BO5", "Steam64", "Steam", "5E", "Perfect World", "Rating Pro", "Rating+", "MVP", "EVP", "Pick'Em"] as const;
const internalVocabulary = /\b(?:CompetitionEntry|EventRoster|Entry|revision|snapshot|canonical|owner|evaluator|registrationConfig|ConversionPolicy|mapping|policy|fallback|migration|schema|sourceSelection|stable ID|approved|roster|eligibility|qualification|minStar|maxStar|targetStarFloor|slopeNum|slopeDen)\b/i;

export function internalProductVocabulary(text: string): string | null {
  const normal = PRODUCT_LANGUAGE_ALLOWED.reduce((value, brand) => value.replaceAll(brand, ""), text);
  return normal.match(internalVocabulary)?.[0] ?? null;
}

const visibleAttributes = new Set(["label", "title", "sub", "description", "placeholder", "alt", "aria-label", "confirmLabel", "eyebrow"]);
const visibleProperties = new Set(["label", "title", "sub", "detail", "description", "message"]);

/** Only literal presentation text is checked, never code identifiers or comments. */
export function productLanguageViolations(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  function visible(node: ts.Node, value: string): boolean {
    // Internal failures are logged; actionError exposes only the generic message.
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isNewExpression(parent) && parent.expression.getText(source) === "AppError" && parent.arguments?.[0]?.getText(source) === "ErrorCode.INTERNAL_ERROR") return false;
      if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "details" && !parent.openingElement.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "open")) return false;
      if (ts.isJsxAttribute(parent)) return visibleAttributes.has(parent.name.getText(source));
      if (ts.isCallExpression(parent)) return false;
      if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)) return false;
      if (ts.isPropertyAssignment(parent) && visibleProperties.has(parent.name.getText(source))) return true;
      if (ts.isJsxExpression(parent) || ts.isJsxText(node)) return true;
    }
    return /[\u3400-\u9fff]/.test(value);
  }
  function visit(node: ts.Node) {
    if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const word = internalProductVocabulary(node.text);
      if (word && visible(node, node.text)) violations.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.text.trim()}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}
