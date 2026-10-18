'use client';

import { useParams } from 'next/navigation';
import { DeviceDetails } from '../../../../features/devices/DeviceDetails';

export default function DeviceDetailsPage() {
  const params = useParams<{ deviceId: string }>();
  return <DeviceDetails deviceId={params.deviceId} />;
}
