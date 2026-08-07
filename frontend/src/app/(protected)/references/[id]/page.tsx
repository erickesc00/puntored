import { ReferenceDetailView } from '@/features/references/detail/reference-detail-view';

interface ReferenceDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ReferenceDetailPage({
  params,
}: ReferenceDetailPageProps) {
  const { id } = await params;

  return <ReferenceDetailView referenceId={id} />;
}
