import { Redirect } from "wouter";

/** Legacy landing URL → official DCCHOME. */
export default function LandingPage() {
  return <Redirect to="/dcc-home" />;
}
