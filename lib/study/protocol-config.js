/** Browser-safe, frozen participant-facing study destinations. */
export const STUDY_INFORMATION_SHEET = Object.freeze({
  version: "PIS-2026-08-09-v1",
  publicPath: "/study/protocol/participant-information-sheet-v1.0.pdf",
  expectedSha256: "02ffb1ce59d6e056cf67b718fddd1798f2acc099a509b871ac42bdcdb08797fa",
  previewPages: Object.freeze([
    Object.freeze({
      page: 1,
      publicPath: "/study/protocol/participant-information-sheet-page-1.png",
      expectedSha256: "dcf2add4ea39b50710e3fbaf484d8807272331c8fcea69c021007bc740c799a0",
      width: 1654,
      height: 2339,
    }),
    Object.freeze({
      page: 2,
      publicPath: "/study/protocol/participant-information-sheet-page-2.png",
      expectedSha256: "571c8b39b45a05b101e6ba03ecd6540fb30b4013f41c767ef38d79fbc411c193",
      width: 1654,
      height: 2339,
    }),
  ]),
});

export const STUDY_FORMS = Object.freeze({
  form1: Object.freeze({
    label: "Participant Intake and Eligibility",
    publicPath: "/study/forms/form1.png",
    expectedSha256: "ac0eda79ab4e92b8c316f7d672845e974f4b5fe2427d13306f1c29680643004e",
    url: "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=yMXEBIzbsUGIK1u3lIQF6D9PZl_aeYNJqeGEWb6Fb8JUOVM4MUlMUTVQT0NMVlUxOUpNSENUSkcwOS4u&origin=QRCode",
  }),
  form2: Object.freeze({
    label: "Post-Learning Questionnaire",
    publicPath: "/study/forms/form2.png",
    expectedSha256: "c2cb495e4d7bca7d02b25e49f7e85e034305d5cdd5a275f5d0cec5e57dc8c62d",
    url: "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=yMXEBIzbsUGIK1u3lIQF6D9PZl_aeYNJqeGEWb6Fb8JUODcxODBLNkJLNjBNQUJPRDFISDZXNVZKMC4u&origin=QRCode",
  }),
  form3: Object.freeze({
    label: "Unaided Quiz",
    publicPath: "/study/forms/form3-quiz.png",
    expectedSha256: "1e1e0ad6e0c4d937f28b128e84e3c65ee810465e104e2ad9a9591230c930512e",
    url: "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=yMXEBIzbsUGIK1u3lIQF6D9PZl_aeYNJqeGEWb6Fb8JUNkpVNlc4RlJTRzFOWktGMVAwWDA0MDFGVi4u&origin=QRCode",
  }),
});
