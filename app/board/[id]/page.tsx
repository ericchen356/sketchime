import { Studio } from '@/components/Studio'

/**
 * One board's editor. The id is only ever used as a localStorage key, so an
 * unknown id lands on an empty board rather than an error - which is also what
 * makes a bookmarked link to a deleted board behave sanely.
 */
export default async function Page({
  params
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const { id } = await params
  return <Studio boardId={id} />
}
