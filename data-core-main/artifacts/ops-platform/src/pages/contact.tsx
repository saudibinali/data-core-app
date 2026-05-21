import { useState } from "react";
import { Link } from "wouter";
import { PublicAuthNav } from "@/components/layout/public-auth-nav";
import { usePublicLocale } from "@/lib/public-locale/context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Building2,
  Mail,
  MessageSquare,
  Headphones,
  Loader2,
  Send,
  Shield,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LOGO_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/official-logo.png`;

export default function ContactPage() {
  const { locale, dir, isRtl, messages } = usePublicLocale();
  const c = messages.contact;
  const { toast } = useToast();
  const Trail = isRtl ? ChevronLeft : ChevronRight;

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState(false);

  const inquiryCards = [
    { icon: Building2, title: c.cardBusinessTitle, text: c.cardBusinessText },
    { icon: MessageSquare, title: c.cardEnterpriseTitle, text: c.cardEnterpriseText },
    { icon: Headphones, title: c.cardSupportTitle, text: c.cardSupportText },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          companyName,
          email,
          subject,
          message,
          website,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        retryAfterSec?: number;
      };

      if (!res.ok) {
        const detail =
          body.error ??
          (res.status === 429
            ? c.errors.rateLimit
            : res.status === 503
              ? c.errors.unavailable
              : c.errors.generic);
        throw new Error(detail);
      }

      toast({
        title: c.toastSuccessTitle,
        description: body.message ?? c.toastSuccessDefault,
      });
      setFullName("");
      setCompanyName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setWebsite("");
    } catch (err) {
      toast({
        variant: "destructive",
        title: c.toastErrorTitle,
        description: err instanceof Error ? err.message : c.errors.generic,
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background" dir={dir} lang={locale}>
      <PublicAuthNav variant="contact" />

      <section
        className="relative overflow-hidden border-b border-white/10"
        style={{
          background: "linear-gradient(180deg, #000000 0%, #0a1628 50%, #0f2744 100%)",
        }}
      >
        <div
          className="absolute inset-0 opacity-25 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 70% 45% at 50% 15%, rgba(0, 123, 255, 0.35) 0%, transparent 65%)",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-12 sm:py-16 text-center">
          <img
            src={LOGO_URL}
            alt=""
            aria-hidden
            className="mx-auto w-24 sm:w-28 h-auto opacity-90 mb-6"
          />
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#5ba3d0]">
            {c.heroEyebrow}
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-white">
            {c.heroTitle}
          </h1>
          <p className="mt-4 text-base sm:text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            {c.heroSubtitle}
          </p>
        </div>
      </section>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-10 sm:py-14">
          <div className="grid lg:grid-cols-3 gap-8 lg:gap-10">
            <div className="lg:col-span-1 space-y-4">
              {inquiryCards.map((card) => (
                <Card key={card.title} className="border-border">
                  <CardHeader className="pb-2">
                    <card.icon className="w-6 h-6 text-primary mb-2" />
                    <CardTitle className="text-base">{card.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm leading-relaxed">{card.text}</CardDescription>
                  </CardContent>
                </Card>
              ))}
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex gap-2 text-xs text-muted-foreground">
                <Shield className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                <p>{c.privacyNote}</p>
              </div>
            </div>

            <div className="lg:col-span-2">
              <Card className="border-border shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Mail className="w-5 h-5 text-primary" />
                    {c.formTitle}
                  </CardTitle>
                  <CardDescription>{c.formSubtitle}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
                    <div
                      className="absolute -left-[9999px] w-px h-px overflow-hidden"
                      aria-hidden
                    >
                      <label htmlFor="website">Website</label>
                      <input
                        id="website"
                        type="text"
                        name="website"
                        tabIndex={-1}
                        autoComplete="off"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="fullName">{c.labelFullName}</Label>
                        <Input
                          id="fullName"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          required
                          minLength={2}
                          maxLength={120}
                          autoComplete="name"
                          disabled={sending}
                          placeholder={c.placeholders.fullName}
                          data-testid="contact-full-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="companyName">{c.labelCompany}</Label>
                        <Input
                          id="companyName"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required
                          minLength={2}
                          maxLength={200}
                          autoComplete="organization"
                          disabled={sending}
                          placeholder={c.placeholders.company}
                          data-testid="contact-company"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">{c.labelEmail}</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        disabled={sending}
                        placeholder={c.placeholders.email}
                        data-testid="contact-email"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="subject">{c.labelSubject}</Label>
                      <Input
                        id="subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        required
                        minLength={3}
                        maxLength={200}
                        disabled={sending}
                        placeholder={c.placeholders.subject}
                        data-testid="contact-subject"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="message">{c.labelMessage}</Label>
                      <Textarea
                        id="message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        required
                        minLength={10}
                        maxLength={5000}
                        rows={6}
                        disabled={sending}
                        className="resize-y min-h-[140px]"
                        placeholder={c.placeholders.message}
                        data-testid="contact-message"
                      />
                      <p className="text-xs text-muted-foreground">{c.messageHint}</p>
                    </div>

                    <Button
                      type="submit"
                      disabled={sending}
                      className="w-full sm:w-auto min-w-[160px]"
                      data-testid="contact-submit"
                    >
                      {sending ? (
                        <>
                          <Loader2 className={cn("w-4 h-4 animate-spin", isRtl ? "ms-2" : "me-2")} />
                          {c.submitting}
                        </>
                      ) : (
                        <>
                          <Send className={cn("w-4 h-4", isRtl ? "ms-2" : "me-2")} />
                          {c.submit}
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <p className="mt-4 text-center text-sm text-muted-foreground">
                {c.alreadyAccount}{" "}
                <Link href="/sign-in" className="text-primary font-medium hover:underline">
                  {c.signInLink}
                </Link>
                {" · "}
                <Link href="/dcc-home" className="text-primary font-medium hover:underline inline-flex items-center">
                  {c.homeLink}
                  <Trail className="inline w-3 h-3 ms-0.5" />
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-4 sm:px-6 lg:px-12 py-6 text-center text-xs text-muted-foreground">
        {c.footer}
      </footer>
    </div>
  );
}
