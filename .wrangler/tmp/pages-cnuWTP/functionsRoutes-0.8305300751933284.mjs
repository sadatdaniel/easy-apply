import { onRequestPost as __api_fetch_posting_ts_onRequestPost } from "C:\\Users\\sadat\\Documents\\easy_cv_tracker\\functions\\api\\fetch-posting.ts"

export const routes = [
    {
      routePath: "/api/fetch-posting",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_fetch_posting_ts_onRequestPost],
    },
  ]