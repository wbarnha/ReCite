/**
 * The sample document the app loads on first visit.
 *
 * Transcribed from *Mata v. Avianca, Inc.*, No. 1:22-cv-01461-PKC (S.D.N.Y.),
 * Doc. 21 (Mar. 1, 2023) — a public court record, and the filing whose
 * citations turned out to be fabricated. It makes the point the tool exists to
 * make: several of these citations are perfectly formed and still wrong, so
 * format checking alone would pass them.
 */
export const SAMPLE_TEXT = `ARGUMENT

I. Legal Standard

In the case of Ashcroft v. Iqbal, 556 U.S. 662 (2009), the Supreme Court held that when
evaluating a motion to dismiss, the court must accept all well-pleaded factual allegations as
true. In Doe v. United States, 419 F.3d 1058 (9th Cir. 2005), the Ninth Circuit held that the
court must accept all well-pleaded factual allegations in the complaint as true.

II. State courts have concurrent jurisdiction

In Shaboon v. Egyptair, 2013 IL App (1st) 111279-U (Ill. App. Ct. 2013), the Illinois Appellate
Court held that state courts have concurrent jurisdiction. Similarly, in Peterson v. Iran Air,
905 F. Supp. 2d 121 (D.D.C. 2012), the District Court for the District of Columbia held the same.
In Ehrlich v. American Airlines, Inc., 360 N.J. Super. 360 (App. Div. 2003), the New Jersey
Appellate Division held that state courts have jurisdiction. In Martinez v. Delta Airlines, Inc.,
2019 WL 4639462 (Tex. App. Sept. 25, 2019), the plaintiff brought a negligence claim. Lastly, in
Estate of Durden v. KLM Royal Dutch Airlines, 2017 WL 2418825 (Ga. Ct. App. June 5, 2017), the
estate of a passenger brought a wrongful death claim.

III. The statute of limitations is tolled

The Eleventh Circuit specifically addresses the effect of a bankruptcy stay in the case of
Varghese v. China Southern Airlines Co., Ltd., 925 F.3d 1339 (11th Cir. 2019). The Bankruptcy
Code provides that the filing of a petition operates as a stay. 11 U.S.C. § 362(a). The tolling
effect of the automatic stay is generally a matter of federal law. See Kaiser Steel Corp. v.
W.S. Ranch Co., 391 U.S. 593, 598, 88 S. Ct. 1753, 20 L.Ed.2d 835 (1968). We have previously
held that the automatic stay provisions may toll the statute of limitations under the Warsaw
Convention. See Zicherman v. Korean Air Lines Co., Ltd., 516 F.3d 1237, 1254 (11th Cir. 2008).

Congress enacted the Montreal Convention to modernize and unify the Warsaw Convention system.
El Al Israel Airlines, Ltd. v. Tseng, 525 U.S. 155, 161, 119 S.Ct. 662, 142 L.Ed.2d 576 (1999).
In doing so, Congress sought to provide passengers with greater certainty. Id. at 166, 119 S. Ct.
662. Allowing the tolling of the limitations period furthers this goal.

In the absence of such a provision, we have held that the automatic stay provision may toll the
statute of limitations under the Warsaw Convention. Miller v. United Airlines, Inc., 174 F.3d
366, 371-72 (2d Cir. 1999); In re Air Crash Disaster Near New Orleans, La., 821 F.2d 1147, 1165
(5th Cir. 1987).
`;

/**
 * A starter authority list, so the demo can show what verification adds.
 *
 * These are the citations from the sample that correspond to real decisions.
 * It is a demonstration fixture, not a legal reference: absence from it means
 * only that this short list does not contain the citation.
 */
export const SAMPLE_CORPUS = [
  { key: "556 U.S. 662", caseName: "Ashcroft v. Iqbal", year: 2009, courtId: "scotus" },
  {
    key: "525 U.S. 155",
    caseName: "El Al Israel Airlines, Ltd. v. Tseng",
    year: 1999,
    courtId: "scotus",
  },
  {
    key: "391 U.S. 593",
    caseName: "Kaiser Steel Corp. v. W.S. Ranch Co.",
    year: 1968,
    courtId: "scotus",
  },
  {
    key: "174 F.3d 366",
    caseName: "Miller v. United Airlines, Inc.",
    year: 1999,
    courtId: "ca2",
  },
  {
    key: "821 F.2d 1147",
    caseName: "In re Air Crash Disaster Near New Orleans, La.",
    year: 1987,
    courtId: "ca5",
  },
];
