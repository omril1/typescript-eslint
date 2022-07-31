import { ASTUtils, TSESTree } from '@typescript-eslint/utils';
import { getESLintCoreRule } from '../util/getESLintCoreRule';
import {
  InferOptionsTypeFromRule,
  InferMessageIdsTypeFromRule,
  createRule,
} from '../util';
import {
  ReportFixFunction,
  RuleFix,
  RuleFixer,
} from '@typescript-eslint/utils/src/ts-eslint';

// const baseRule = getESLintCoreRule('brace-style');
const baseRule = getESLintCoreRule('key-spacing');

export type Options = InferOptionsTypeFromRule<typeof baseRule>;
export type MessageIds = InferMessageIdsTypeFromRule<typeof baseRule>;

interface AlignOptions {
  align?: { on: string; mode: string; beforeColon: number; afterColon: number };
  on: string;
  mode: string;
  beforeColon: number;
  afterColon: number;
}

function initOptionProperty(
  toOptions: AlignOptions,
  fromOptions: AlignOptions,
): AlignOptions {
  toOptions.mode = fromOptions.mode || 'strict';

  // Set value of beforeColon
  if (typeof fromOptions.beforeColon !== 'undefined') {
    toOptions.beforeColon = +fromOptions.beforeColon;
  } else {
    toOptions.beforeColon = 0;
  }

  // Set value of afterColon
  if (typeof fromOptions.afterColon !== 'undefined') {
    toOptions.afterColon = +fromOptions.afterColon;
  } else {
    toOptions.afterColon = 1;
  }

  // Set align if exists
  if (typeof fromOptions.align !== 'undefined') {
    if (typeof fromOptions.align === 'object') {
      toOptions.align = fromOptions.align;
    } else {
      // "string"
      toOptions.align = {
        on: fromOptions.align,
        mode: toOptions.mode,
        beforeColon: toOptions.beforeColon,
        afterColon: toOptions.afterColon,
      };
    }
  }

  return toOptions;
}

interface InitOptions {
  singleLine: AlignOptions;
  multiLine: AlignOptions;
  align?: AlignOptions;
}

function initOptions(
  toOptions: InitOptions,
  fromOptions: InitOptions,
): InitOptions {
  if (typeof fromOptions.align === 'object') {
    // Initialize the alignment configuration
    toOptions.align = initOptionProperty({} as AlignOptions, fromOptions.align);
    toOptions.align.on = fromOptions.align.on || 'colon';
    toOptions.align.mode = fromOptions.align.mode || 'strict';

    toOptions.multiLine = initOptionProperty(
      {} as AlignOptions,
      fromOptions.multiLine || fromOptions,
    );
    toOptions.singleLine = initOptionProperty(
      {} as AlignOptions,
      fromOptions.singleLine || fromOptions,
    );
  } else {
    // string or undefined
    toOptions.multiLine = initOptionProperty(
      {} as AlignOptions,
      fromOptions.multiLine || fromOptions,
    );
    toOptions.singleLine = initOptionProperty(
      {} as AlignOptions,
      fromOptions.singleLine || fromOptions,
    );

    // If alignment options are defined in multiLine, pull them out into the general align configuration
    if (toOptions.multiLine.align) {
      toOptions.align = {
        on: toOptions.multiLine.align.on,
        mode: toOptions.multiLine.align.mode || toOptions.multiLine.mode,
        beforeColon: toOptions.multiLine.align.beforeColon,
        afterColon: toOptions.multiLine.align.afterColon,
      };
    }
  }

  return toOptions;
}

export default createRule<Options, MessageIds>({
  name: 'key-spacing',
  meta: {
    type: 'layout',
    docs: {
      description: 'Enforce consistent brace style for blocks',
      recommended: false,
      extendsBaseRule: true,
    },
    messages: baseRule.meta.messages,
    fixable: baseRule.meta.fixable,
    hasSuggestions: baseRule.meta.hasSuggestions,
    schema: baseRule.meta.schema,
  },
  defaultOptions: [{}],
  create(context) {
    const [style, { allowSingleLine = false } = {}] = context.options;
    const options = context.options[0] || {};
    const ruleOptions = initOptions(
      {} as InitOptions,
      options as unknown as InitOptions,
    );
    const multiLineOptions = ruleOptions.multiLine;
    const singleLineOptions = ruleOptions.singleLine;
    const alignmentOptions = ruleOptions.align ?? null;

    const sourceCode = context.getSourceCode();
    const rules = baseRule.create(context);
    function getLastTokenBeforeColon(node: TSESTree.Node): TSESTree.Token | null {
      const typeSeparatorToken = sourceCode.getTokenAfter(node, t => t.type === TSESTree.AST_TOKEN_TYPES.Punctuator);

      return typeSeparatorToken && sourceCode.getTokenBefore(typeSeparatorToken);
    }

    function getKeyWidth(
      property: TSESTree.TSEnumMember | TSESTree.TypeElement,
    ): number {
      const startToken = sourceCode.getFirstToken(property)!;
      let endToken: TSESTree.Token | null;
      if (property.type === TSESTree.AST_NODE_TYPES.TSEnumMember) {
        endToken = getLastTokenBeforeColon(property.id);
      } else {
        switch (property.type) {
          case TSESTree.AST_NODE_TYPES.TSCallSignatureDeclaration:
          case TSESTree.AST_NODE_TYPES.TSConstructSignatureDeclaration:
          case TSESTree.AST_NODE_TYPES.TSMethodSignature: {
            endToken = getLastTokenBeforeColon(property.returnType!);
            break;
          }
          case TSESTree.AST_NODE_TYPES.TSIndexSignature:
          case TSESTree.AST_NODE_TYPES.TSPropertySignature: {
            endToken = getLastTokenBeforeColon(property.typeAnnotation!);
            break;
          }
        }
      }

      return (endToken?.range[1] ?? 0) - startToken.range[0];
    }

    interface ColonSpaces {
      beforeColon: string;
      afterColon: string;
    }

    function getPropertyWhitespace(
      property: TSESTree.TSEnumMember | TSESTree.TypeElement,
    ): ColonSpaces | null {
      let whitespace!: RegExpExecArray | null;

      if (property.type === TSESTree.AST_NODE_TYPES.TSEnumMember) {
        whitespace = /(\s*)=(\s*)/u.exec(
          sourceCode
            .getText()
            .slice(property.id.range[1], property.initializer?.range[0]),
        );
      } else if (
        property.type === TSESTree.AST_NODE_TYPES.TSPropertySignature
      ) {
        const range = sourceCode
          .getText()
          .slice(property.key.range[1], property.typeAnnotation!.range[1]);
        whitespace = /(\s*):(\s*)/u.exec(
          range,
        );
      }

      if (whitespace) {
        return {
          beforeColon: whitespace[1],
          afterColon: whitespace[2],
        };
      }
      return null;
    }

    function getNextColon(node: TSESTree.TSTypeAnnotation): TSESTree.Token {
      return sourceCode.getTokens(node)[0];
    }
    function getKey(property: TSESTree.TSEnumMember | TSESTree.TypeElement): string {
      let startToken;
      if (property.type === TSESTree.AST_NODE_TYPES.TSEnumMember) {
        startToken = property;
        if (property.computed) {
          return sourceCode.getText().slice(startToken.range[0], startToken.range[1]);
        }
      } else {
        switch (property.type) {
          case TSESTree.AST_NODE_TYPES.TSCallSignatureDeclaration:
          case TSESTree.AST_NODE_TYPES.TSConstructSignatureDeclaration:
          case TSESTree.AST_NODE_TYPES.TSMethodSignature: {
            startToken = property;
            break;
          }
          case TSESTree.AST_NODE_TYPES.TSIndexSignature: {
            startToken = property;
            break;
          }
          case TSESTree.AST_NODE_TYPES.TSPropertySignature: {
            startToken = property.key;
            if (property.computed) {
              return sourceCode.getText().slice(startToken.range[0], startToken.range[1]);
            }
            return sourceCode.getText().slice(startToken.range[0], startToken.range[1]);
          }
        }
      }
      // return ASTUtils.getPropertyName(property)!;
      return sourceCode.getText(property);
    }

    function report(
      property: TSESTree.TypeElement,
      side: 'id' | 'initializer',
      whitespace: string,
      expected: number,
      mode: string | undefined,
    ): void {
      const diff = whitespace.length - expected;
      console.log({ property: sourceCode.getText(property) ,whitespace, expected, diff });

      if (
        ((diff && mode === 'strict') ||
          (diff < 0 && mode === 'minimum') ||
          (diff > 0 && !expected && mode === 'minimum')) &&
        !(expected && ASTUtils.LINEBREAK_MATCHER.test(whitespace))
      ) {
        let nextColon: TSESTree.Token | null;
        switch (property.type) {
          case TSESTree.AST_NODE_TYPES.TSCallSignatureDeclaration:
          case TSESTree.AST_NODE_TYPES.TSConstructSignatureDeclaration:
          case TSESTree.AST_NODE_TYPES.TSMethodSignature: {
            nextColon = getNextColon(property.returnType!);
            break;
          }
          case TSESTree.AST_NODE_TYPES.TSIndexSignature:
          case TSESTree.AST_NODE_TYPES.TSPropertySignature: {
            nextColon = getNextColon(property.typeAnnotation!);
            break;
          }
        }
        if (!nextColon) {
          console.log('could not find next colon', sourceCode.getText());
          return;
        }
        const tokenBeforeColon = sourceCode.getTokenBefore(nextColon, {
          includeComments: true,
        })!;
        const tokenAfterColon = sourceCode.getTokenAfter(nextColon, {
          includeComments: true,
        })!;
        console.log({ tokenBeforeColon, tokenAfterColon });
        const isKeySide = side === 'id';
        const isExtra = diff > 0;
        const diffAbs = Math.abs(diff);
        console.log({ isKeySide, isExtra, diffAbs, diff });
        const spaces = Array(diffAbs + 1).join(' ');

        const locStart = isKeySide
          ? tokenBeforeColon.loc.end
          : nextColon.loc.start;
        const locEnd = isKeySide
          ? nextColon.loc.start
          : tokenAfterColon.loc.start;
        const missingLoc = isKeySide
          ? tokenBeforeColon.loc
          : tokenAfterColon.loc;
        const loc = isExtra ? { start: locStart, end: locEnd } : missingLoc;

        let fix: ReportFixFunction | null = null;

        if (isExtra) {
          let range: number[];

          // Remove whitespace
          if (isKeySide) {
            range = [
              tokenBeforeColon.range[1],
              tokenBeforeColon.range[1] + diffAbs,
            ];
          } else {
            range = [
              tokenAfterColon.range[0] - diffAbs,
              tokenAfterColon.range[0],
            ];
          }
          fix = function (fixer: RuleFixer): RuleFix {
            return fixer.removeRange(range as [number, number]);
          };
        } else {
          // Add whitespace
          if (isKeySide) {
            fix = function (fixer: RuleFixer): RuleFix {
              return fixer.insertTextAfter(tokenBeforeColon, spaces);
            };
          } else {
            fix = function (fixer: RuleFixer): RuleFix {
              return fixer.insertTextBefore(tokenAfterColon, spaces);
            };
          }
        }

        let messageId:
          | 'extraKey'
          | 'extraValue'
          | 'missingKey'
          | 'missingValue';

        if (isExtra) {
          messageId = side === 'id' ? 'extraKey' : 'extraValue';
        } else {
          messageId = side === 'id' ? 'missingKey' : 'missingValue';
        }

        context.report({
          node: property[side],
          loc,
          messageId,
          data: {
            key: getKey(property),
            computed: property.type === TSESTree.AST_NODE_TYPES.TSEnumMember ? 'computed' : '',
          },
          fix,
        });
      }
    }

    // function verifyEnumGroupAlignment(properties: TSESTree.TSEnumMember[]): void {
    //   const length = properties.length,
    //       widths = properties.map(getKeyWidth), // Width of keys, including quotes
    //       align = alignmentOptions.on; // "value" or "colon"
    //   let targetWidth = Math.max(...widths),
    //       beforeColon, afterColon, mode;

    //   if (alignmentOptions && length > 1) { // When aligning values within a group, use the alignment configuration.
    //       beforeColon = alignmentOptions.beforeColon;
    //       afterColon = alignmentOptions.afterColon;
    //       mode = alignmentOptions.mode;
    //   } else {
    //       beforeColon = multiLineOptions.beforeColon;
    //       afterColon = multiLineOptions.afterColon;
    //       mode = alignmentOptions.mode;
    //   }

    //   // Conditionally include one space before or after colon
    //   targetWidth += (align === "colon" ? beforeColon : afterColon);

    //   for (let i = 0; i < length; i++) {
    //       const property = properties[i];
    //       const whitespace = getPropertyWhitespace(property);

    //       if (whitespace) { // Object literal getters/setters lack a colon
    //           const width = widths[i];

    //           if (align === "value") {
    //               report(property, "id", whitespace.beforeColon, beforeColon, mode);
    //               report(property, "initializer", whitespace.afterColon, targetWidth - width, mode);
    //           } else { // align = "colon"
    //               report(property, "id", whitespace.beforeColon, targetWidth - width, mode);
    //               report(property, "initializer", whitespace.afterColon, afterColon, mode);
    //           }
    //       }
    //   }
    // }

    function verifyInterfaceGroupAlignment(
      properties: TSESTree.TypeElement[],
    ): void {
      const length = properties.length;
      const widths = properties.map(getKeyWidth); // Width of keys, including quotes
      const align = alignmentOptions?.on; // "value" or "colon"
      let targetWidth = Math.max(...widths);
      let beforeColon: number;
      let afterColon: number;
      let mode: string | undefined;

      if (alignmentOptions && length > 1) {
        // When aligning values within a group, use the alignment configuration.
        beforeColon = alignmentOptions.beforeColon;
        afterColon = alignmentOptions.afterColon;
        mode = alignmentOptions.mode;
      } else {
        beforeColon = multiLineOptions.beforeColon;
        afterColon = multiLineOptions.afterColon;
        mode = alignmentOptions?.mode;
      }

      // Conditionally include one space before or after colon
      targetWidth += align === 'colon' ? beforeColon : afterColon;

      for (let i = 0; i < length; i++) {
        const property = properties[i];
        const whitespace = getPropertyWhitespace(property);

        if (!whitespace) {
            continue;
        }
        // Object literal getters/setters lack a colon
        const width = widths[i];

        console.log({ whitespace, widths, width, targetWidth });

        if (align === 'value') {
          report(property, 'id', whitespace.beforeColon, beforeColon, mode);
          report(
            property,
            'initializer',
            whitespace.afterColon,
            targetWidth - width,
            mode,
          );
        } else {
          // align = "colon"
          report(
            property,
            'id',
            whitespace.beforeColon,
            targetWidth - width,
            mode,
          );
          report(
            property,
            'initializer',
            whitespace.afterColon,
            afterColon,
            mode,
          );
        }
      }
    }

    function checkPrecedingSpace(node: TSESTree.TSInterfaceBody): void {
      verifyInterfaceGroupAlignment(node.body);
      // const precedingToken = sourceCode.getTokenBefore(node);
      // if (precedingToken && isTokenOnSameLine(precedingToken, node)) {
      //   const hasSpace = sourceCode.isSpaceBetweenTokens(
      //     precedingToken,
      //     node as TSESTree.Token,
      //   );

      //   if (!hasSpace) {
      //     context.report({
      //       node,
      //       messageId: 'extraKey',
      //       data: {
      //           computed: false ? "computed " : "",
      //           key: getKey(property)
      //       },
      //       fix(fixer) {
      //         return fixer.insertTextBefore(node, ' ');
      //       },
      //     });
      //   } else if (hasSpace) {
      //     context.report({
      //       node,
      //       messageId: 'extraValue',
      //       data: {
      //           computed: false ? "computed " : "",
      //           key: getKey(property)
      //       },
      //       fix(fixer) {
      //         return fixer.removeRange([
      //           precedingToken.range[1],
      //           node.range[0],
      //         ]);
      //       },
      //     });
      //   }
      // }
    }

    function checkSpaceAfterEnum(node: TSESTree.TSEnumDeclaration): void {
      // verifyEnumGroupAlignment(node.members);
      // const punctuator = sourceCode.getTokenAfter(node.id);
      // if (punctuator) {
      //   checkPrecedingSpace(punctuator);
      // }
    }

    return {
      ...rules,
      TSEnumDeclaration: checkSpaceAfterEnum,
      TSInterfaceBody: checkPrecedingSpace,
    };
  },
});
