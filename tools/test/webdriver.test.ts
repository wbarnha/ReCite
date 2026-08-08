/**
 * The WebDriver client, against a stubbed transport.
 *
 * `safari.test.ts` needs macOS and a running `safaridriver`, so on every other
 * machine — including the one most of this was written on — it skips. That
 * leaves the protocol itself untested exactly where it is most likely to be
 * wrong, because a hand-written client is a pile of URL shapes and envelope
 * unwrapping that no type checker can confirm.
 *
 * So the transport is stubbed and the wire format is asserted directly. This
 * cannot prove Safari behaves; it can prove the client speaks W3C, which is the
 * half that fails silently as "the assertion timed out".
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reachable,
  waitForElement,
  WebDriverError,
  WebDriverSession,
} from "./helpers/webdriver.js";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecc";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

/** Record every request, and reply with whatever the case needs. */
function stub(reply: (call: Call) => { status?: number; value: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const { status = 200, value } = reply(call);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify({ value })),
    } as Response);
  });
  return calls;
}

const BASE = "http://127.0.0.1:4444";

/** Open a session against whatever stub is installed, discarding the calls. */
async function session_(_calls: Call[]) {
  return WebDriverSession.open(BASE);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the WebDriver client", () => {
  it("opens a session the way W3C spells it", async () => {
    const calls = stub(() => ({
      value: { sessionId: "s1", capabilities: { browserName: "safari" } },
    }));

    const session = await WebDriverSession.open(BASE, "safari");

    expect(calls[0]?.url).toBe(`${BASE}/session`);
    expect(calls[0]?.method).toBe("POST");
    // `capabilities.alwaysMatch`, not the legacy `desiredCapabilities`, which
    // safaridriver rejects outright.
    expect(calls[0]?.body).toEqual({
      capabilities: { alwaysMatch: { browserName: "safari" } },
    });
    expect(session.sessionId).toBe("s1");
  });

  it("names the browser it is driving", async () => {
    stub(() => ({
      value: {
        sessionId: "s1",
        capabilities: {
          browserName: "safari",
          browserVersion: "26.5.2",
          platformName: "mac",
        },
      },
    }));
    const session = await WebDriverSession.open(BASE);
    expect(session.describe()).toBe("safari 26.5.2 on mac");
  });

  it("navigates and executes against the session path", async () => {
    const calls = stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: "ReCite" },
    );

    const session = await WebDriverSession.open(BASE);
    await session.navigate("http://example.test/ReCite/");
    const title = await session.execute<string>("return document.title");

    // Two navigations: `about:blank` first, so the previous document cannot be
    // mistaken for the one that was asked for.
    expect(calls[1]).toMatchObject({
      url: `${BASE}/session/s1/url`,
      method: "POST",
      body: { url: "about:blank" },
    });
    expect(calls[2]).toMatchObject({
      url: `${BASE}/session/s1/url`,
      body: { url: "http://example.test/ReCite/" },
    });
    expect(calls[3]).toMatchObject({
      url: `${BASE}/session/s1/execute/sync`,
      body: { script: "return document.title", args: [] },
    });
    expect(title).toBe("ReCite");
  });

  it("unwraps the element key rather than returning the envelope", async () => {
    stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: { [ELEMENT_KEY]: "e17" } },
    );

    const session = await WebDriverSession.open(BASE);
    expect(await session.find("textarea")).toBe("e17");
  });

  it("reports a missing element as absent, not as a failure", async () => {
    // The one error W3C returns that is an ordinary answer rather than a fault.
    stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : {
            status: 404,
            value: { error: "no such element", message: "nothing matched" },
          },
    );

    const session = await WebDriverSession.open(BASE);
    await expect(session.find(".missing")).resolves.toBeUndefined();
  });

  it("keeps the remote's own wording when a command fails", async () => {
    // The whole point of driving the real browser is what it says when it is
    // unhappy; swallowing that for a generic "request failed" wastes the run.
    stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : {
            status: 500,
            value: {
              error: "javascript error",
              message: "undefined is not a function (near '...e of t...')",
            },
          },
    );

    const session = await WebDriverSession.open(BASE);
    await expect(session.execute("return 1")).rejects.toThrow(WebDriverError);
    await expect(session.execute("return 1")).rejects.toThrow(
      /undefined is not a function/,
    );
  });

  it("sends a file path as both text and characters", async () => {
    // safaridriver has historically wanted the legacy `value` array alongside
    // the spec's `text`; sending both costs nothing and works on every remote.
    const calls = stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: null },
    );

    const session = await WebDriverSession.open(BASE);
    await session.sendKeys("e1", "/tmp/a.pdf");

    expect(calls[1]?.url).toBe(`${BASE}/session/s1/element/e1/value`);
    expect(calls[1]?.body).toEqual({
      text: "/tmp/a.pdf",
      value: [..."/tmp/a.pdf"],
    });
  });

  it("accepts the legacy element key that real remotes still send", async () => {
    // The bug that turned the Safari job red twice. Reading only the W3C key
    // made every lookup return nothing, which is indistinguishable from "the
    // element is not on the page" — so the failure pointed at the app instead
    // of at the protocol, including for a plainly visible `textarea`.
    stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: { ELEMENT: "legacy-7" } },
    );

    const session = await WebDriverSession.open(BASE);
    expect(await session.find("textarea")).toBe("legacy-7");
  });

  it("takes the reference even under a key neither name predicted", async () => {
    stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: { "some-future-key": "e42" } },
    );

    const session = await WebDriverSession.open(BASE);
    expect(await session.find("textarea")).toBe("e42");
  });

  it("says what came back when it cannot find a reference at all", async () => {
    // Loud rather than silent: a bare `undefined` here reads as "no such
    // element" and sends the reader hunting the page rather than the protocol.
    stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: { unexpected: 12, alsoUnexpected: 13 } },
    );

    const session = await WebDriverSession.open(BASE);
    await expect(session.find("textarea")).rejects.toThrow(
      /no recognisable element reference.*unexpected/s,
    );
  });

  it("clears the page before navigating, so a stale document cannot be observed", async () => {
    // The bug this exists to hold. Navigating straight from one page of the app
    // to another left the previous document readable, so a wait for `h1` — which
    // both pages have — matched instantly and handed back a document being torn
    // down. Every lookup against it then found nothing, and real Safari failed
    // three tests in 200ms each while reporting only "expected undefined".
    const calls = stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: null },
    );

    const session = await WebDriverSession.open(BASE);
    await session.navigate("http://example.test/ReCite/");

    expect(calls.slice(1).map((c) => (c.body as { url: string }).url)).toEqual([
      "about:blank",
      "http://example.test/ReCite/",
    ]);
  });

  it("does not blank the page when the target is already about:blank", async () => {
    const calls = stub((call) =>
      call.url.endsWith("/session")
        ? { value: { sessionId: "s1", capabilities: {} } }
        : { value: null },
    );

    const session = await WebDriverSession.open(BASE);
    await session.navigate("about:blank");
    expect(calls).toHaveLength(2);
  });

  it("waits for an element instead of asking once", async () => {
    // React renders after the document is ready, so a single-shot lookup races
    // the first render — and loses silently, because a miss looks exactly like
    // "there is no such element".
    let polls = 0;
    const calls = stub((call) => {
      if (call.url.endsWith("/session")) {
        return { value: { sessionId: "s1", capabilities: {} } };
      }
      if (call.url.endsWith("/execute/sync")) {
        polls += 1;
        return { value: polls >= 3 };
      }
      return { value: { [ELEMENT_KEY]: "e9" } };
    });

    expect(await waitForElement(await session_(calls), "textarea", 5_000)).toBe("e9");
    expect(polls, "it should have polled until the element appeared").toBe(3);
  });

  it("says so when an element appears and then vanishes", async () => {
    // The handle would belong to a document that has been replaced, and every
    // later use of it fails with a stale-element error instead of this one.
    const calls = stub((call) => {
      if (call.url.endsWith("/session")) {
        return { value: { sessionId: "s1", capabilities: {} } };
      }
      if (call.url.endsWith("/execute/sync")) return { value: true };
      return {
        status: 404,
        value: { error: "no such element", message: "gone" },
      };
    });

    await expect(waitForElement(await session_(calls), ".page", 2_000)).rejects.toThrow(
      /still changing/,
    );
  });

  it("treats an unreachable server as absent rather than throwing", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    await expect(reachable(BASE)).resolves.toBe(false);
  });

  it("survives a reply that is not JSON at all", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("<html>proxy error</html>"),
      } as Response),
    );
    await expect(WebDriverSession.open(BASE)).rejects.toThrow(/not.*JSON/i);
  });
});
