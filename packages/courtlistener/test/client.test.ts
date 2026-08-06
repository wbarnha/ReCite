/**
 * What the client sends, and what it refuses to send.
 *
 * The assertions about the request body are the load-bearing ones. ReCite's
 * whole proposition is that a document does not leave the machine, and this
 * package is the only thing in the repository that can open a connection at
 * all — so "the body contains a volume, a reporter and a page, and nothing
 * else" is a claim that has to fail loudly rather than drift.
 */

import { parse } from "@recite/core";
import { describe, expect, it } from "vitest";

import {
  buildLookupForm,
  CITATION_LOOKUP_PATH,
  citationComponents,
  CourtListenerClient,
  CourtListenerError,
  CourtListenerProvider,
  interpret,
  looksLikeToken,
  RateLimiter,
  redact,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponse,
} from "../src/index.js";

const TOKEN = "0123456789abcdef0123456789abcdef01234567";

interface Call {
  readonly url: string;
  readonly init: HttpRequestInit;
}

function respond(status: number, body: unknown): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** A `fetch` that records every call and answers from a queue of replies. */
function recorder(replies: (call: Call) => HttpResponse): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      const call = { url, init };
      calls.push(call);
      return Promise.resolve(replies(call));
    },
  };
}

const cluster = (over: Record<string, unknown> = {}) => ({
  id: 108713,
  absolute_url: "/opinion/108713/roe-v-wade/",
  case_name: "Roe v. Wade",
  date_filed: "1973-01-22",
  citation_count: 2500,
  court_id: "scotus",
  sub_opinions: ["https://www.courtlistener.com/api/rest/v4/opinions/108713/"],
  ...over,
});

const found = [{ citation: "410 U.S. 113", status: 200, clusters: [cluster()] }];

/** A limiter that never actually waits, so tests take milliseconds. */
const instant = () =>
  new RateLimiter({ perWindow: 1000, sleep: () => Promise.resolve() });

const provider = (fetchImpl: FetchLike, over: Record<string, unknown> = {}) =>
  new CourtListenerProvider({
    client: new CourtListenerClient({ token: TOKEN, fetch: fetchImpl }),
    limiter: instant(),
    ...over,
  });

describe("what may be transmitted", () => {
  it("reduces a citation to three fields and no more", () => {
    const [citation] = parse("Roe v. Wade, 410 U.S. 113, 153 (1973).").citations;
    const components = citationComponents(citation!)!;
    expect(components).toEqual({ volume: "410", reporter: "U.S.", page: "113" });
    expect(Object.keys(buildLookupForm(components)).sort()).toEqual([
      "page",
      "reporter",
      "volume",
    ]);
  });

  it("sends the canonical reporter rather than the author's spacing", () => {
    const [citation] = parse("Tseng, 119 S.Ct. 662 (1999).").citations;
    expect(citationComponents(citation!)?.reporter).toBe("S. Ct.");
  });

  it("has nothing to send for a short form or a statute", () => {
    const { citations } = parse(
      "Iqbal, 556 U.S. 662 (2009). Id. at 678. See 11 U.S.C. § 362(a).",
    );
    const kinds = citations.filter((c) => citationComponents(c) !== undefined);
    expect(kinds.every((c) => c.kind === "case-reporter")).toBe(true);
    expect(kinds).toHaveLength(1);
  });

  it("posts only the citation components, never the document", async () => {
    // The endpoint also accepts a `text` field, which would be fewer requests
    // and would post a client's brief to a third party. It is never used, and
    // this is the test that says so.
    const secret = "PRIVILEGED — Draft memorandum, do not circulate.";
    const { fetch, calls } = recorder(() => respond(200, found));

    await provider(fetch).verify(
      parse(`${secret}\n\nRoe v. Wade, 410 U.S. 113 (1973).`).citations,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://www.courtlistener.com${CITATION_LOOKUP_PATH}`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe("volume=410&reporter=U.S.&page=113");
    expect(calls[0]!.init.body).not.toContain("PRIVILEGED");
    expect(calls[0]!.init.body).not.toContain("text=");
  });

  it("authenticates with the token, and only with the token", async () => {
    const { fetch, calls } = recorder(() => respond(200, found));
    await provider(fetch).verify(parse("410 U.S. 113 (1973).").citations);

    expect(calls[0]!.init.headers["Authorization"]).toBe(`Token ${TOKEN}`);
    expect(calls[0]!.init.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("makes no request at all when the document has no full citations", async () => {
    const { fetch, calls } = recorder(() => respond(200, found));
    await provider(fetch).verify(parse("Id. at 678. See supra note 4.").citations);
    expect(calls).toEqual([]);
  });

  it("refuses to be built without a token", () => {
    expect(
      () =>
        new CourtListenerClient({
          token: "  ",
          fetch: () => Promise.reject(new Error("never called")),
        }),
    ).toThrow(CourtListenerError);
  });

  it("refuses a path that is not a path", async () => {
    const client = new CourtListenerClient({
      token: TOKEN,
      fetch: () => Promise.resolve(respond(200, [])),
    });
    await expect(client.json("https://example.invalid/steal")).rejects.toThrow(
      /refusing a request/,
    );
  });

  it("recognises a token that has the wrong shape before anything is sent", () => {
    expect(looksLikeToken(TOKEN)).toBe(true);
    expect(looksLikeToken("someone@example.com")).toBe(false);
    expect(looksLikeToken("abc")).toBe(false);
  });
});

describe("the token never reaches a message", () => {
  it("is redacted out of anything a user might read", () => {
    expect(redact(`Authorization: Token ${TOKEN}`)).not.toContain(TOKEN);
    expect(redact(`request failed for ${TOKEN}`)).toBe("request failed for …");
  });

  it("is redacted out of errors the client raises", async () => {
    const client = new CourtListenerClient({
      token: TOKEN,
      fetch: () => Promise.reject(new Error(`bad token ${TOKEN}`)),
    });
    await expect(client.json("/api/rest/v4/opinions/1/")).rejects.toThrow(
      /^(?:(?!0123456789).)*$/s,
    );
  });
});

describe("interpreting an answer", () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ["a match", { status: 200, clusters: [cluster()] }, "found"],
    [
      "several matches under 200",
      { status: 200, clusters: [cluster(), cluster({ id: 2 })] },
      "ambiguous",
    ],
    ["an explicit 300", { status: 300, clusters: [cluster()] }, "ambiguous"],
    ["no match", { status: 404, clusters: [] }, "not-found"],
    ["an unparseable citation", { status: 400, clusters: [] }, "invalid"],
    ["a throttle", { status: 429, clusters: [] }, "unchecked"],
    ["nothing at all", undefined, "unchecked"],
  ];

  it.each(cases)("reads %s as %s", (_label, raw, expected) => {
    expect(interpret(0, "410 U.S. 113", raw as never).status).toBe(expected);
  });

  it("keeps the case name, the year and a usable link", () => {
    const match = interpret(0, "410 U.S. 113", {
      status: 200,
      clusters: [cluster()],
    });
    expect(match.clusters[0]).toMatchObject({
      caseName: "Roe v. Wade",
      year: 1973,
      url: "https://www.courtlistener.com/opinion/108713/roe-v-wade/",
      courtId: "scotus",
    });
  });

  it("drops a cluster with no identifier rather than half-using it", () => {
    const match = interpret(0, "410 U.S. 113", {
      status: 200,
      clusters: [{ case_name: "Nameless" }],
    });
    expect(match.clusters).toEqual([]);
  });
});

describe("the provider", () => {
  it("hands the engine a record the VF rules can use", async () => {
    const { fetch } = recorder(() => respond(200, found));
    const results = await provider(fetch).verify(
      parse("Roe v. Wade, 410 U.S. 113 (1973).").citations,
    );

    const result = [...results.values()][0]!;
    expect(result.status).toBe("found");
    expect(result.source).toBe("CourtListener");
    expect(result.records[0]).toMatchObject({
      key: "410 U.S. 113",
      caseName: "Roe v. Wade",
      year: 1973,
    });
  });

  it("looks a repeated citation up once", async () => {
    const { fetch, calls } = recorder(() => respond(200, found));
    const results = await provider(fetch).verify(
      parse("Roe v. Wade, 410 U.S. 113 (1973). See also Roe, 410 U.S. 113 (1973).")
        .citations,
    );

    expect(calls).toHaveLength(1);
    // Both citations still get an answer; only the request was shared.
    expect([...results.values()].filter((r) => r.status === "found")).toHaveLength(2);
  });

  it("reports a failed lookup as unchecked, never as absent", async () => {
    // The failure mode that would matter most: a timeout that reads as
    // "CourtListener says this case does not exist".
    const client = new CourtListenerClient({
      token: TOKEN,
      fetch: () => Promise.reject(new Error("network down")),
    });
    const subject = new CourtListenerProvider({ client, limiter: instant() });
    const results = await subject.verify(parse("410 U.S. 113 (1973).").citations);

    expect([...results.values()][0]!.status).toBe("unchecked");
    expect(subject.notices.join(" ")).toMatch(/could not be checked/);
  });

  it("says so when a rejected token stopped the run", async () => {
    const { fetch } = recorder(() => respond(401, "unauthorized"));
    const subject = provider(fetch);
    await subject.verify(parse("410 U.S. 113 (1973).").citations);
    expect(subject.notices.join(" ")).toMatch(/rejected the API token/);
  });

  it("stops at its ceiling and says what it left alone", async () => {
    const { fetch, calls } = recorder(() => respond(200, found));
    const text = [
      "410 U.S. 113 (1973).",
      "556 U.S. 662 (2009).",
      "174 F.3d 366 (2d Cir. 1999).",
    ].join(" ");

    const subject = provider(fetch, { maxLookups: 2 });
    await subject.verify(parse(text).citations);

    expect(calls).toHaveLength(2);
    expect(subject.notices.join(" ")).toMatch(/first 2 of 3 distinct citations/);
  });

  it("keeps the cluster so a pin cite does not need a second lookup", async () => {
    const { fetch } = recorder(() => respond(200, found));
    const subject = provider(fetch);
    await subject.verify(parse("Roe v. Wade, 410 U.S. 113, 153 (1973).").citations);
    expect(subject.matchFor(0)?.clusters[0]?.id).toBe(108713);
  });

  it("does not re-ask about a citation it has already been told about", async () => {
    // Applying a fix re-checks the document. Spending another round of rate
    // limit on answers that cannot have changed would make every correction
    // slower than the one before it.
    const { fetch, calls } = recorder(() => respond(200, found));
    const subject = provider(fetch);
    const citations = parse("Roe v. Wade, 410 U.S. 113 (1973).").citations;

    await subject.verify(citations);
    const second = await subject.verify(citations);

    expect(calls).toHaveLength(1);
    expect([...second.values()][0]!.status).toBe("found");
  });

  it("asks again after a failure, because a failure is not an answer", async () => {
    let attempt = 0;
    const { fetch } = recorder(() => {
      attempt++;
      return attempt === 1 ? respond(500, "down") : respond(200, found);
    });
    const subject = provider(fetch);
    const citations = parse("410 U.S. 113 (1973).").citations;

    expect([...(await subject.verify(citations)).values()][0]!.status).toBe(
      "unchecked",
    );
    expect([...(await subject.verify(citations)).values()][0]!.status).toBe("found");
  });

  it("reports progress so a slow run does not look stalled", async () => {
    const { fetch } = recorder(() => respond(200, found));
    const seen: Array<[number, number]> = [];
    const subject = provider(fetch, {
      onProgress: (done: number, total: number) => seen.push([done, total]),
    });
    await subject.verify(parse("410 U.S. 113 (1973). 556 U.S. 662 (2009).").citations);
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("the rate limiter", () => {
  it("lets the first window through without waiting", async () => {
    let slept = 0;
    const limiter = new RateLimiter({
      perWindow: 3,
      now: () => 1000,
      sleep: (ms) => {
        slept += ms;
        return Promise.resolve();
      },
    });
    for (let i = 0; i < 3; i++) await limiter.take();
    expect(slept).toBe(0);
  });

  it("waits exactly long enough for the oldest request to age out", async () => {
    let clock = 1000;
    const waits: number[] = [];
    const limiter = new RateLimiter({
      perWindow: 2,
      windowMs: 60_000,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });

    await limiter.take();
    clock += 10_000;
    await limiter.take();
    await limiter.take();

    // The first request was at t=1000, so the window frees at t=61000; the
    // clock stood at t=11000, which is 50 seconds and a millisecond.
    expect(waits).toEqual([50_001]);
  });

  it("serialises callers so two cannot claim the same slot", async () => {
    let clock = 0;
    const limiter = new RateLimiter({
      perWindow: 1,
      windowMs: 100,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    });

    await Promise.all([limiter.take(), limiter.take(), limiter.take()]);
    expect(clock).toBe(202);
  });
});
