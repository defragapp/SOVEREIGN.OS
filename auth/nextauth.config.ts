import NextAuth, { type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import EmailProvider from "next-auth/providers/nodemailer";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const authConfig: NextAuthConfig = {
  adapter: SupabaseAdapter({ url: process.env.SUPABASE_URL!, secret: process.env.SUPABASE_SERVICE_ROLE_KEY! }),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: { params: { prompt: "consent", access_type: "offline", response_type: "code" } },
    }),
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    }),
    EmailProvider({
      server: process.env.EMAIL_SERVER!,
      from: process.env.EMAIL_FROM ?? "noreply@sovereign.os",
      maxAge: 10 * 60, // magic link expires in 10 minutes
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.userId = user.id;
        token.role = (user as { role?: string }).role ?? "user";
      }
      // Mint a Supabase-compatible JWT for Row-Level Security
      if (account && token.userId) {
        token.supabaseToken = jwt.sign(
          { sub: token.userId, role: token.role, aud: "authenticated" },
          process.env.SUPABASE_JWT_SECRET!,
          { expiresIn: "1h" }
        );
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.userId as string;
        (session as { supabaseToken?: string }).supabaseToken = token.supabaseToken as string;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Block disposable email domains
      const blocked = ["mailinator.com", "guerrillamail.com", "tempmail.com"];
      const domain = user.email?.split("@")[1] ?? "";
      if (blocked.includes(domain)) return false;
      // Provision credits on first sign-in (Google/Apple OAuth)
      if (account?.type === "oauth" && user.id) {
        await supabase.rpc("provision_new_user_credits", {
          p_user_id: user.id,
          p_credits: 100,
        }).catch(() => {/* non-fatal */});
      }
      return true;
    },
  },
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify",
    error: "/auth/error",
  },
  events: {
    async createUser({ user }) {
      await supabase.from("user_profiles").insert({
        id: user.id,
        email: user.email,
        display_name: user.name ?? user.email?.split("@")[0],
        created_at: new Date().toISOString(),
      }).catch(() => {});
    },
  },
  debug: process.env.NODE_ENV === "development",
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
