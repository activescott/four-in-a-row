import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";

// A software WebAuthn authenticator (ES256, "none" attestation) for tests, so
// the real passkey provider and @simplewebauthn/server verify real signatures.
// The published auth packages ship no passkey test helper.

type CborValue = number | string | Uint8Array | Map<CborValue, CborValue>;

function cborHead(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  throw new Error("CBOR value too long for this encoder");
}

function cbor(value: CborValue): Uint8Array {
  if (typeof value === "number") {
    return Uint8Array.from(
      value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value),
    );
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(Uint8Array.from(cborHead(3, bytes.length)), bytes);
  }
  if (value instanceof Uint8Array) {
    return concat(Uint8Array.from(cborHead(2, value.length)), value);
  }
  const parts: Uint8Array[] = [Uint8Array.from(cborHead(5, value.size))];
  for (const [key, item] of value) parts.push(cbor(key), cbor(item));
  return concat(...parts);
}

function concat(...parts: ArrayLike<number>[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
}

function sha256(data: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function uint32(value: number): Uint8Array {
  return Uint8Array.from([
    value >>> 24,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_DATA = 0x40;

export class SoftAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly credentialId = new Uint8Array(randomBytes(16));
  private counter = 0;

  constructor(
    private readonly origin: string,
    private readonly rpId: string,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id() {
    return b64url(this.credentialId);
  }

  // navigator.credentials.create(), serialised as RegistrationResponseJSON
  register(options: { challenge: string }) {
    const jwk = this.publicKey.export({ format: "jwk" });
    const coseKey = cbor(
      new Map<CborValue, CborValue>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
      ]),
    );
    const authData = concat(
      sha256(this.rpId),
      Uint8Array.of(
        FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA,
      ),
      uint32(this.counter),
      new Uint8Array(16), // aaguid
      Uint8Array.of(
        this.credentialId.length >> 8,
        this.credentialId.length & 0xff,
      ),
      this.credentialId,
      coseKey,
    );
    const attestationObject = cbor(
      new Map<CborValue, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: this.clientData("webauthn.create", options.challenge),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  // navigator.credentials.get(), serialised as AuthenticationResponseJSON
  authenticate(options: { challenge: string }) {
    this.counter += 1;
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);
    const authenticatorData = concat(
      sha256(this.rpId),
      Uint8Array.of(FLAG_USER_PRESENT | FLAG_USER_VERIFIED),
      uint32(this.counter),
    );
    const signature = sign(
      "sha256",
      concat(
        authenticatorData,
        sha256(Buffer.from(clientDataJSON, "base64url")),
      ),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData: b64url(authenticatorData),
        signature: b64url(new Uint8Array(signature)),
      },
      clientExtensionResults: {},
    };
  }

  private clientData(type: string, challenge: string) {
    const json = JSON.stringify({
      type,
      challenge,
      origin: this.origin,
      crossOrigin: false,
    });
    return b64url(new TextEncoder().encode(json));
  }
}
