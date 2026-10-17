// The question card (D-381): everything visible at rest, the recommended option first and marked, number keys for the first four.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QuestionCard as Question } from "../../src/api/http.ts";
import { QuestionCard } from "../../src/web/chat/QuestionCard.tsx";
import { optionForKey } from "../../src/web/chat/question-keys.ts";

const question: Question = {
  toolUseId: "t1", question: "Replace the config on your keyboard, or add this one beside it?",
  options: [{ label: "Add it as a new config", description: "The current one stays." }, { label: "Replace the current config" }], allowOther: true, answer: null,
};
const render = (q: Question, disabled = false) => renderToStaticMarkup(createElement(QuestionCard, { question: q, disabled, onAnswer: () => {} }));

describe("QuestionCard", () => {
  test("an open question shows every option as a button, the first marked recommended, and Something else when allowed", () => {
    const html = render(question);
    expect(html).toContain("Add it as a new config");
    expect(html).toContain("Replace the current config");
    expect(html).toContain("The current one stays.");
    expect(html.match(/Recommended/g)).toHaveLength(1);
    expect(html.indexOf("Recommended")).toBeLessThan(html.indexOf("Replace the current config"));
    expect(html).toContain("Something else…");
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('tabindex="0"');
  });

  test("without allowOther there is no free-text way out, and a busy reply disables the buttons", () => {
    const html = render({ ...question, allowOther: false }, true);
    expect(html).not.toContain("Something else");
    expect(html).toContain("disabled");
  });

  test("an answered question is a quiet read-only line with the answer and no buttons", () => {
    const html = render({ ...question, answer: "Add it as a new config" });
    expect(html).toContain("ask-card-done");
    expect(html).toContain("Add it as a new config");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Recommended");
  });

  test("number keys 1 to 4 pick the option in that place, and nothing else does", () => {
    const options = ["a", "b", "c", "d"];
    expect(["1", "2", "3", "4"].map((k) => optionForKey(k, options))).toEqual(options);
    expect(optionForKey("5", options)).toBeUndefined();
    expect(optionForKey("0", options)).toBeUndefined();
    expect(optionForKey("3", ["a", "b"])).toBeUndefined();
    expect(optionForKey("a", options)).toBeUndefined();
  });
});
