import { SignJWT } from "jose";

const secret = new TextEncoder().encode("test-jwt-secret");

const token = await new SignJWT({ sub: "test-user" })
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime("1h")
  .sign(secret);

console.log(token);