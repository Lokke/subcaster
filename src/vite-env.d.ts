/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENSUBSONIC_URL: string
  readonly VITE_OPENSUBSONIC_USERNAME: string
  readonly VITE_OPENSUBSONIC_PASSWORD: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
