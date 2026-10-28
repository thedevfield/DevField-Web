import { StatusView } from "@/components/auth/StatusView";

export default function CheckEmailPage() {
  return <StatusView eyebrow="NEXT STEP / EMAIL" title="이메일을 확인해주세요."
    description="입력하신 주소로 가입 인증이 가능한 경우 안내 메일이 발송됩니다. 메일함과 스팸함을 확인해주세요. 인증을 마친 뒤 이메일로 로그인할 수 있습니다."
    tone="mail" primary={{ href: "/login/email", label: "이메일 로그인" }}
    secondary={{ href: "/signup/email", label: "가입 화면으로 돌아가기" }} />;
}
