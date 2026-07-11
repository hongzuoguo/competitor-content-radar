import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}, ref): React.JSX.Element {
  return (
    <button className={`button button--${variant} ${className}`.trim()} ref={ref} type={type} {...props}>
      {icon}
      {children}
    </button>
  )
})
