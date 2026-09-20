import { Button, Stack, Typography } from '@mui/material';
import { type PagedListState } from '../../hooks/usePagedList';

/** "Page N" + Previous / Next for a server-side cursor list (no total count: that would be another query). */
export function PagerBar({ list, pageSize }: { list: Pick<PagedListState<unknown>, 'pageIndex' | 'hasPrevious' | 'hasNext' | 'previous' | 'next' | 'status'>; pageSize: number }) {
  return (
    <Stack direction="row" sx={{ p: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">
        Page {list.pageIndex + 1} · up to {pageSize} per page
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" onClick={list.previous} disabled={!list.hasPrevious || list.status === 'loading'}>
          Previous
        </Button>
        <Button size="small" onClick={list.next} disabled={!list.hasNext}>
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
