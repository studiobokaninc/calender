import React, { useEffect, useState, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { DateClickArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import * as jaLocale from '@fullcalendar/core/locales/ja';
import { format, parseISO } from 'date-fns';
import { EventClickArg } from '@fullcalendar/core';
import api from '../services/api';
import { Project, Task, BackendEvent, CalendarEvent } from '../types';
import EventDetailsPanel from '../components/EventDetailsPanel';

const sortEventsForDisplay = (eventsToSort: CalendarEvent[]): CalendarEvent[] => {
  console.log('Sorting events for display...');
  const typeOrder: { [key: string]: number } = { project: 1, task: 2, event: 3 };
  return [...eventsToSort].sort((a, b) => {
    const aType = a.extendedProps?.type || 'event';
    const bType = b.extendedProps?.type || 'event';
    const aSortKey = typeOrder[aType] ?? 9;
    const bSortKey = typeOrder[bType] ?? 9;
    if (aSortKey !== bSortKey) { return aSortKey - bSortKey; }
    const getProjectStartDate = (event: CalendarEvent): number => {
      const projStartDate = event.extendedProps?.project_start_date;
      return projStartDate ? new Date(projStartDate).getTime() : Infinity;
    };
    const aProjectStart = getProjectStartDate(a);
    const bProjectStart = getProjectStartDate(b);
    if (aProjectStart !== bProjectStart) { return aProjectStart - bProjectStart; }
    const aStart = a.start?.getTime() ?? Infinity;
    const bStart = b.start?.getTime() ?? Infinity;
    if (aStart !== bStart) { return aStart - bStart; }
    const aEnd = a.end?.getTime() ?? -Infinity;
    const bEnd = b.end?.getTime() ?? -Infinity;
    if (aEnd !== bEnd) { return bEnd - aEnd; }
    return (a.title ?? '').localeCompare(b.title ?? '');
  });
};

const getEventColor = (type?: string) => {
  switch (type) {
    case 'meeting': return '#1976d2';
    case 'review': return '#9c27b0';
    case 'deadline': return '#d32f2f';
    default: return '#2196f3';
  }
}
const getProjectColor = (project: Project) => {
  if (project.color) return project.color;
  switch (project.status) {
    case 'planning': return '#FF9800';
    case 'in-progress': return '#4CAF50';
    case 'completed': return '#9E9E9E';
    default: return '#757575';
  }
}
const getTaskColor = (status?: string) => {
  switch (status) {
    case 'todo': return '#FFC107';
    case 'in-progress': return '#03A9F4';
    case 'done': return '#8BC34A';
    default: return '#BDBDBD';
  }
}

const Calendar: React.FC = () => {
  const calendarRef = useRef<FullCalendar>(null);
  const calendarWrapperRef = useRef<HTMLDivElement>(null);
  const [rawEvents, setRawEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const eventsForDisplay = useMemo(() => sortEventsForDisplay(rawEvents), [rawEvents]);

  // --- Debounce 関数 (再追加) ---
  const debounce = (func: () => void, wait: number) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return function executedFunction() {
      const later = () => {
        timeout = null;
        func();
      };
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(later, wait);
    };
  };

  const fetchData = useCallback(async () => {
    console.log('Fetching data for month:', currentMonth);
    setLoading(true);
    setError(null);
    try {
      const [projectsResponse, tasksResponse, eventsResponse] = await Promise.all([
        api.get<Project[]>('/projects'),
        api.get<Task[]>('/tasks'),
        api.get<BackendEvent[]>('/calendar/events', {
        })
      ]);

      const projectsData = projectsResponse.data;
      const projectEvents: CalendarEvent[] = projectsData.map((project) => ({
        id: `project-${project.id}`,
        title: project.name,
        start: parseISO(project.start_date),
        end: parseISO(project.end_date),
        allDay: true,
        backgroundColor: getProjectColor(project),
        borderColor: getProjectColor(project),
        classNames: ['project-bar'],
        extendedProps: {
          project_id: String(project.id),
          status: project.status,
          type: 'project',
          project_start_date: project.start_date
        }
      }));
      setProjects(projectsData);

      const tasksData = tasksResponse.data;
      const taskEvents: CalendarEvent[] = tasksData.map((task) => {
        const relatedProject = projectsData.find(p => p.id === task.project_id);
        return {
          id: `task-${task.id}`,
          title: task.name,
          start: parseISO(task.due_date),
          end: parseISO(task.due_date),
          allDay: true,
          backgroundColor: getTaskColor(task.status),
          borderColor: getTaskColor(task.status),
          classNames: ['task-event'],
          extendedProps: {
            task_id: String(task.id),
            status: task.status,
            type: 'task',
            project_id: String(task.project_id),
            project_start_date: relatedProject?.start_date
          }
        };
      });

      const eventsData = eventsResponse.data;
      const normalEvents: CalendarEvent[] = eventsData.map((event) => {
        const relatedProject = projectsData.find(p => p.id === event.project_id);
        return {
          id: String(event.id),
          title: event.name,
          description: event.description,
          start: parseISO(event.start_time),
          end: parseISO(event.end_time),
          allDay: false,
          location: event.location,
          backgroundColor: getEventColor(event.type),
          borderColor: getEventColor(event.type),
          classNames: ['timed-event'],
          extendedProps: {
            project_id: String(event.project_id),
            task_id: String(event.task_id),
            status: event.status,
            source: event.source,
            type: event.type || 'event',
            location: event.location,
            project_start_date: relatedProject?.start_date
          }
        };
      });

      setRawEvents([...projectEvents, ...taskEvents, ...normalEvents]);

    } catch (err) {
      console.error('データの取得に失敗しました:', err);
      setError('データの取得/処理中にエラーが発生しました。');
      setRawEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDateClick = useCallback((arg: DateClickArg) => {
    console.log('Date clicked:', arg.date);
    setSelectedDate(arg.date);
    setSelectedEvent(null);
  }, []);

  const handleEventClick = useCallback((eventOrClickInfo: CalendarEvent | EventClickArg) => {
    let eventToSelect: CalendarEvent | undefined | null = null;

    if ('event' in eventOrClickInfo) {
      console.log('Event clicked (FullCalendar):', eventOrClickInfo.event);
      eventToSelect = eventsForDisplay.find(ev => ev.id === eventOrClickInfo.event.id);
      if (!eventToSelect) {
          console.warn('Clicked event not found in display events (fallback):', eventOrClickInfo.event.id);
          eventToSelect = {
              id: eventOrClickInfo.event.id,
              title: eventOrClickInfo.event.title,
              start: eventOrClickInfo.event.start ?? new Date(),
              end: eventOrClickInfo.event.end ?? eventOrClickInfo.event.start ?? new Date(),
              allDay: eventOrClickInfo.event.allDay,
              extendedProps: eventOrClickInfo.event.extendedProps,
          };
      }
    } else {
      console.log('Event selected (Details Panel):', eventOrClickInfo);
      eventToSelect = eventOrClickInfo;
    }

    if (eventToSelect) {
      setSelectedEvent(eventToSelect);
      setSelectedDate(null);
    }
  }, [eventsForDisplay]);

  // ★★★ ResizeObserver でカレンダーサイズを更新する Effect ★★★
  useLayoutEffect(() => {
    const handleResize = debounce(() => {
      if (calendarRef.current) {
        calendarRef.current.getApi().updateSize();
        console.log('FullCalendar size updated by ResizeObserver.');
      }
    }, 0);

    let resizeObserver: ResizeObserver | null = null;

    if (calendarWrapperRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize(); // コンテナサイズ変更時に debounce された updateSize を呼ぶ
      });
      resizeObserver.observe(calendarWrapperRef.current);
    }

    // 初期サイズ設定 (少し遅延)
    const initialTimeout = setTimeout(handleResize, 250);

    // クリーンアップ関数
    return () => {
      clearTimeout(initialTimeout);
      if (resizeObserver && calendarWrapperRef.current) {
        resizeObserver.unobserve(calendarWrapperRef.current);
      }
    };
  }, []);

  // データ読み込み完了時の Effect (念のため維持)
  useEffect(() => {
    if (!loading && calendarRef.current) {
      const timeoutId = setTimeout(() => {
         if (calendarRef.current) {
           calendarRef.current.getApi().updateSize();
           console.log('FullCalendar size updated after loading complete.');
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [loading]);

  // ★★★ viewDidMount コールバックを追加 ★★★
  const handleViewDidMount = useCallback(() => {
    // debounce または setTimeout を使って少し遅延させる
    const timeoutId = setTimeout(() => {
       if (calendarRef.current) {
         calendarRef.current.getApi().updateSize();
         console.log('FullCalendar size updated on viewDidMount.');
      }
    }, 50); // 50ms 遅延
    // return () => clearTimeout(timeoutId); // 通常不要
  }, []); // 空の依存配列

  return (
    <Box sx={{ p: 2, flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <style>{`
        /* 全体的なフォント縮小 */
        .fc {
          font-size: 0.85em; /* 全体のベースフォントサイズを少し小さく */
        }
        /* ヘッダーツールバー調整 */
        .fc .fc-header-toolbar {
          margin-bottom: 0.5em !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        .fc .fc-toolbar-chunk {
          display: flex;
          align-items: center;
        }
        .fc .fc-button {
          padding: 2px 6px !important;
          font-size: 0.9em !important;
        }
        .fc .fc-toolbar-title {
          font-size: 1.2em !important;
        }

        /* 曜日ヘッダー調整 */
        .fc .fc-col-header-cell {
           padding: 2px 0 !important;
        }
        .fc .fc-col-header-cell-cushion {
          font-size: 0.8em !important;
          padding: 1px 2px !important;
        }

        /* 日付番号調整 */
        .fc-daygrid-day-number {
          padding: 1px 2px !important;
          font-size: 0.85em !important;
          text-align: center !important; /* ★ 日付を中央揃え */
          width: 100%;
        }

        /* 日付セル全体の最小高さ調整 */
         .fc .fc-daygrid-day-frame {
           min-height: 85px; /* セルの最小高さを調整 (80px -> 85px) */
         }

        /* イベント共通スタイル調整 */
        .fc-event {
           font-size: 0.8em !important;
           padding: 0 2px !important;
           line-height: 1.4 !important;
           border-radius: 2px; /* 少し角丸 */
        }
        .fc-daygrid-event {
           margin-top: 1px !important;
           margin-bottom: 1px !important;
        }

        /* 時間指定イベント用テキストスタイル */
        .timed-event-text {
           display: block;
           white-space: nowrap;
           overflow: hidden;
           text-overflow: ellipsis;
           padding: 1px 0; /* 縦のパディング調整 */
           font-weight: 500; /* 少し太字に */
        }
        /* 月表示の時間指定イベントのドットを非表示にする (テキスト表示するので) */
        .fc-daygrid-dot-event .fc-event-dot {
           display: none;
        }
        /* 月表示の時間指定イベントの背景をなくす */
        .fc-daygrid-dot-event {
           background-color: transparent !important;
           border: none !important;
           padding: 0 !important; /* パディングもリセット */
           margin: 1px 0 !important; /* マージン調整 */
        }
        /* 月表示の時間指定イベントのテキスト位置調整 */
        .fc-daygrid-dot-event .fc-event-title {
            padding: 0 !important;
        }

        /* ★★★ 複数日終日イベントの高さ制限とoverflow ★★★ */
        .fc-daygrid-event.fc-daygrid-block-event {
           /* 1行分の高さに近づける (line-heightに合わせて調整) */
           max-height: calc(1.4em + 2px); /* line-height + vertical padding/border */
           overflow: hidden;
        }
        /* +N more リンクのスタイル調整 (必要であれば) */
        .fc-daygrid-more-link {
           font-size: 0.8em !important;
        }

      `}</style>
      <Typography variant="h5" gutterBottom>
        カレンダー
      </Typography>
      <Box sx={{ flexGrow: 1, display: 'flex', gap: 2, overflow: 'hidden', minHeight: 0 }}>
        <div
          ref={calendarWrapperRef}
          style={{
            flexGrow: 1,       // 残りの幅を使う
            overflow: 'hidden', // はみ出しを隠す
            minHeight: 0,      // 高さ計算の問題回避
            position: 'relative' // ローディング表示のため (sxから移動)
          }}
        >
          {loading && (
            <CircularProgress sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
          )}
          {error && (
            <Typography color="error" sx={{ textAlign: 'center', mt: 2 }}>{error}</Typography>
          )}
          {!loading && !error && (
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
              initialView="dayGridMonth"
              locale={jaLocale.default}
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
              }}
              events={eventsForDisplay}
              height="100%"
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventContent={(eventInfo) => {
                const event = eventInfo.event;
                const isAllDay = event.allDay;

                if (!isAllDay) {
                    // --- 時間指定イベント (テキスト表示) ---
                    // 月表示 (.fc-daygrid-dot-event) と 週/日表示 (.fc-timegrid-event) で微妙に構造が違う可能性があるため注意
                    // ここでは共通のテキスト表示を返す
                    return (
                      <span className="timed-event-text"
                            style={{ color: event.backgroundColor || '#3788d8' }} // 元の背景色を文字色に
                      >
                        ・{event.start ? format(event.start, 'HH:mm') : ''}〜 {event.title}
                      </span>
                    );
                } else {
                    // --- 終日イベント (プロジェクトバー、終日タスクなど) ---
                    const sxProps: React.CSSProperties = {
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        backgroundColor: event.backgroundColor || '#757575',
                        color: '#fff',
                        padding: '0 4px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        // fontSize は .fc-event で指定
                    };

                    return (
                      <Box sx={sxProps}>
                        <Typography component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 'inherit' }}>
                          {event.title}
                        </Typography>
                      </Box>
                    );
                }
              }}
              dayMaxEventRows={true}
              viewDidMount={handleViewDidMount}
            />
          )}
        </div>

        <Box sx={{
          display: { xs: 'none', sm: 'block' }, // xs (extra-small) では非表示, sm (small) 以上で表示
          width: 300,
          minWidth: 300,
          flexShrink: 0,
          // 必要に応じてボーダーや高さをこちらで管理
          height: '100%', // 親の高さに合わせる
          borderLeft: 1,
          borderColor: 'divider',
        }}>
          <EventDetailsPanel
            selectedDate={selectedDate}
            selectedEvent={selectedEvent}
            events={eventsForDisplay}
            onEventSelect={handleEventClick}
          />
        </Box>

      </Box>
    </Box>
  );
};

export default Calendar; 