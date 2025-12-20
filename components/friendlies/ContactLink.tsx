interface ContactLinkProps {
  type: 'tel' | 'mailto';
  value: string;
  className?: string;
  children?: React.ReactNode;
}

export function ContactLink({ type, value, className = '', children }: ContactLinkProps) {
  if (!value) return null;

  const href = type === 'tel'
    ? `tel:${value.replace(/\s/g, '')}`
    : `mailto:${value}`;

  return (
    <a
      href={href}
      className={`text-blue-600 hover:text-blue-800 transition-colors ${className}`}
    >
      {children || value}
    </a>
  );
}

export function PhoneLink({ phone, className = '' }: { phone: string; className?: string }) {
  return <ContactLink type="tel" value={phone} className={className} />;
}

export function EmailLink({ email, className = '' }: { email: string; className?: string }) {
  return <ContactLink type="mailto" value={email} className={className} />;
}
