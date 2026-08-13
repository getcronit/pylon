import {Link as LinkComp, LinkProps as LinkCompProps} from 'react-router'

interface LinkProps extends Omit<LinkCompProps, 'to'> {
  href: LinkCompProps['to']
}

export const Link: React.FC<LinkProps> = props => {
  const {href, ...rest} = props
  return <LinkComp to={href} {...rest} />
}
