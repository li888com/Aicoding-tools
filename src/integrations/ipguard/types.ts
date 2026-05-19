export type IpGuardConfig = {
  url: string;
  name: string;
  password: string;
};

export type IpGuardLoginResponse = {
  error: string;
  loginid: string;
};

export type IpGuardUploadResponse = {
  error: string;
  file: unknown;
};

export type IpGuardEncryptCheckResponse = {
  error: string;
  encrypt: boolean;
};

export type IpGuardDecryptResponse = {
  error: string;
};

export type DecryptResult = {
  type: "text" | "binary";
  content?: string;
  decryptedFilePath?: string;
  originalFilePath: string;
  wasEncrypted: boolean;
};