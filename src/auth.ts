import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyCredentials } from "@/modules/admin";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export const DEMO_MODE = process.env.DEMO_MODE === "true";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      id: "credentials",
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(raw) {
        const email = String(raw?.email ?? "");
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;
        const user = await verifyCredentials(db, email, password);
        return user ? { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` } : null;
      },
    }),
    // Demo mode only: one-click switch to any active user (role switcher). Disabled unless DEMO_MODE=true.
    Credentials({
      id: "demo",
      credentials: { email: { label: "Email" } },
      async authorize(raw) {
        if (!DEMO_MODE) return null;
        const email = String(raw?.email ?? "").toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;
        return { id: user.id, email: user.email, name: `${user.firstName} ${user.lastName}` };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
