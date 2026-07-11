import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: ReactNode
}

export function Button({
  variant = 'primary',
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button className={`button button--${variant} ${className}`.trim()} type={type} {...props}>
      {icon}
      {children}
    </button>
  )
}
