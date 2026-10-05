-- Candidate migration only. Deploy with scheduler credentials and reviewed functions.
alter table public.devices add column schedule_version bigint not null default 0;
alter table public.schedules add column exceptions date[] not null default '{}',
  add column automation_ready boolean not null default true;
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check(kind in ('tomorrow_reminder','attendance_success','attendance_failed','attendance_unknown','attendance_missed','setup_summary'));
alter table public.notification_outbox add column logical_key text,
  add column attempts integer not null default 0,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column delivery_state text not null default 'queued'
    check(delivery_state in ('queued','sending','accepted','uncertain','discarded')),
  add column provider_accepted_at timestamptz,
  add column phone_receipt_confirmed_at timestamptz;
-- Legacy sent_at was also used by notification reads, so it cannot prove ntfy acceptance.
-- Preserve the timestamp but describe old completed rows conservatively; never replay them.
update public.notification_outbox set delivery_state='uncertain',last_error=coalesce(last_error,'legacy_delivery_evidence_unverified') where sent_at is not null;
update public.notification_outbox set delivery_state='discarded' where discarded_at is not null and sent_at is null;
create unique index notification_outbox_logical_idx on public.notification_outbox(device_id,logical_key) where logical_key is not null;

create or replace function public.register_attendance_device(p_key text,p_name text,p_token_hash text,p_topic text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if length(p_key) not between 8 and 160 or p_token_hash !~ '^[a-f0-9]{64}$' or p_topic !~ '^soton-attendance-[a-f0-9]{40}$' then raise exception 'invalid_device'; end if;
  insert into public.devices(device_key,device_name,auth_token_hash,last_seen_at)
    values(p_key,left(p_name,100),p_token_hash,now()) returning id into v_id;
  insert into public.notification_preferences(device_id) values(v_id);
  insert into public.push_subscriptions(device_id,provider,provider_token) values(v_id,'ntfy',p_topic);
  return jsonb_build_object('deviceId',v_id,'ntfyTopic',p_topic);
exception when unique_violation then
  -- Only replay a registration with the same durable secret. Never rotate ownership.
  select id into v_id from public.devices where device_key=p_key and auth_token_hash=p_token_hash for update;
  if found then
    return jsonb_build_object('deviceId',v_id,'ntfyTopic',(select provider_token from public.push_subscriptions where device_id=v_id and provider='ntfy' and enabled order by created_at limit 1));
  end if;
  return jsonb_build_object('error','device_identifier_exists');
end;
$$;

-- Lock the device, validate BEFORE deletion, replace + preferences in one transaction.
create or replace function public.replace_attendance_schedules(p_device uuid,p_version bigint,p_schedules jsonb,p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_current bigint; r jsonb; v_date text;
begin
  select schedule_version into v_current from public.devices where id=p_device for update;
  if not found then raise exception 'device_not_found'; end if;
  if p_version<=0 or p_version>9007199254740991 or jsonb_typeof(p_schedules) is distinct from 'array' or jsonb_array_length(p_schedules)>200 then raise exception 'invalid_snapshot'; end if;
  if p_version<=v_current then return jsonb_build_object('ok',true,'stale',p_version<v_current,'version',v_current); end if;
  for r in select value from jsonb_array_elements(p_schedules) loop
    if coalesce(r->>'course_code','') !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$'
      or coalesce(r->>'weekday','') !~ '^[0-6]$'
      or coalesce(r->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(r->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (r->>'end_time') <= (r->>'start_time')
      or coalesce(r->>'timezone','') <> 'Asia/Kuala_Lumpur'
      or jsonb_typeof(r->'enabled') is distinct from 'boolean'
      or jsonb_typeof(r->'automation_ready') is distinct from 'boolean'
      or jsonb_typeof(r->'exceptions') is distinct from 'array'
      or jsonb_array_length(r->'exceptions')>366 then raise exception 'invalid_schedule'; end if;
    if coalesce(r->>'form_url','') <> '' and (r->>'form_url') !~* '^https://(forms\.office\.com|forms\.cloud\.microsoft)(/r/[A-Za-z0-9_-]+/?([?][^#]*)?|/Pages/ResponsePage\.aspx[?]([^#]*&)?id=[^&#]+[^#]*)$' then raise exception 'invalid_form_url'; end if;
    if (r->>'automation_ready')::boolean and coalesce(r->>'form_url','')='' then raise exception 'missing_form_url'; end if;
    for v_date in select jsonb_array_elements_text(r->'exceptions') loop
      if v_date !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v_date::date,'YYYY-MM-DD')<>v_date then raise exception 'invalid_exception'; end if;
    end loop;
  end loop;
  if jsonb_typeof(p_preferences) is distinct from 'object' or coalesce(p_preferences->>'timezone','')<>'Asia/Kuala_Lumpur'
    or coalesce(p_preferences->>'reminder_time','')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or jsonb_typeof(p_preferences->'reminders_enabled') is distinct from 'boolean'
    or jsonb_typeof(p_preferences->'success_notifications_enabled') is distinct from 'boolean' then raise exception 'invalid_preferences'; end if;
  delete from public.schedules where device_id=p_device;
  insert into public.schedules(device_id,course_code,course_name,weekday,start_time,end_time,form_url,timezone,enabled,automation_ready,exceptions)
    select p_device,item.value->>'course_code',item.value->>'course_name',(item.value->>'weekday')::smallint,(item.value->>'start_time')::time,(item.value->>'end_time')::time,item.value->>'form_url','Asia/Kuala_Lumpur',(item.value->>'enabled')::boolean,(item.value->>'automation_ready')::boolean,
      array(select jsonb_array_elements_text(item.value->'exceptions')::date)
    from jsonb_array_elements(p_schedules) as item(value);
  insert into public.notification_preferences(device_id,timezone,reminder_time,reminders_enabled,success_notifications_enabled)
    values(p_device,'Asia/Kuala_Lumpur',(p_preferences->>'reminder_time')::time,(p_preferences->>'reminders_enabled')::boolean,(p_preferences->>'success_notifications_enabled')::boolean)
    on conflict(device_id) do update set timezone=excluded.timezone,reminder_time=excluded.reminder_time,reminders_enabled=excluded.reminders_enabled,success_notifications_enabled=excluded.success_notifications_enabled;
  update public.devices set schedule_version=p_version where id=p_device;
  return jsonb_build_object('ok',true,'scheduleCount',jsonb_array_length(p_schedules),'version',p_version);
end;
$$;

create or replace function public.record_attendance_event(p_device uuid,p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status text; v_course text; v_key text; v_label text;
begin
  v_status=p_event->>'status';v_course=p_event->>'course_code';v_key=p_event->>'occurrence_key';
  if v_status not in ('success','failed','unknown','missed') or coalesce(v_key,'')='' or length(v_key)>300
    or coalesce(v_course,'')!~'^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$'
    or coalesce(p_event->>'class_date','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_event'; end if;
  insert into public.attendance_logs(device_id,occurrence_key,course_code,class_date,start_time,end_time,form_url,status,detail)
    values(p_device,v_key,v_course,(p_event->>'class_date')::date,(p_event->>'start_time')::time,(p_event->>'end_time')::time,p_event->>'form_url',v_status,left(p_event->>'detail',500))
    on conflict(device_id,occurrence_key) do update set status=excluded.status,detail=excluded.detail,occurred_at=now()
    where public.attendance_logs.status in ('scheduled','launched');
  select status into v_status from public.attendance_logs where device_id=p_device and occurrence_key=v_key;
  v_label=case v_status when 'success' then '打卡成功' when 'failed' then '自动打卡失败' when 'unknown' then '打卡结果不明，请手动核对；不会自动重试' else '错过打卡时间，请手动处理' end;
  insert into public.notification_outbox(device_id,logical_key,kind,title,body,payload)
    values(p_device,'event:'||v_key,'attendance_'||v_status,v_label,v_course||' · '||(p_event->>'class_date')||'：'||v_label,p_event)
    on conflict(device_id,logical_key) where logical_key is not null do nothing;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.record_setup_summary(p_device uuid,p_session text,p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_session !~ '^[A-Za-z0-9-]{8,100}$' or jsonb_typeof(p_summary) is distinct from 'object'
    or coalesce(p_summary->>'count','')!~'^[0-9]{1,3}$' or coalesce(p_summary->>'passed','')!~'^[0-9]{1,3}$'
    or (p_summary->>'passed')::integer>(p_summary->>'count')::integer then raise exception 'invalid_setup_summary'; end if;
  if not exists(select 1 from public.entitlements where device_id=p_device and status='active' and phone_notifications and starts_at<=now() and expires_at>now()) then
    return jsonb_build_object('ok',true,'queued',false,'reason','subscription_required');
  end if;
  insert into public.notification_outbox(device_id,logical_key,kind,title,body,payload)
    values(p_device,'setup:'||p_session,'setup_summary','设置检查完成',format('已确认 %s / %s 个表单课型。检查未提交学校表单。',p_summary->>'passed',p_summary->>'count'),p_summary)
    on conflict(device_id,logical_key) where logical_key is not null do nothing;
  return jsonb_build_object('ok',true,'queued',true);
end;
$$;

create or replace function public.enqueue_attendance_reminders(p_date date)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.notification_outbox(device_id,logical_key,kind,title,body,payload)
    select s.device_id,'reminder:'||p_date,'tomorrow_reminder','明日自动打卡安排',
      '明日课程：'||string_agg(s.course_code||' '||to_char(s.start_time,'HH24:MI'),'、' order by s.start_time)||'。每节结束前 5 分钟自动执行，无需每日确认；请保持 Chrome 运行、电脑清醒和学校登录有效。',
      jsonb_build_object('classDate',p_date,'courses',jsonb_agg(jsonb_build_object('courseCode',s.course_code,'startTime',s.start_time,'endTime',s.end_time)))
    from public.schedules s join public.notification_preferences p on p.device_id=s.device_id
    where s.weekday=extract(dow from p_date) and s.enabled and s.automation_ready and not(p_date=any(s.exceptions)) and p.reminders_enabled
    group by s.device_id on conflict(device_id,logical_key) where logical_key is not null do nothing;
  get diagnostics n=row_count;return n;
end;
$$;

create or replace function public.claim_attendance_notifications(p_limit integer default 10)
returns setof public.notification_outbox language plpgsql security definer set search_path = '' as $$
begin
  -- A crashed sender may have reached the provider: quarantine expired sending leases.
  update public.notification_outbox set delivery_state='uncertain',discarded_at=now(),last_error='worker_lease_expired_delivery_uncertain',lease_token=null,lease_until=null
    where delivery_state='sending' and lease_until<now() and sent_at is null and discarded_at is null;
  return query with picked as (
    select id from public.notification_outbox where sent_at is null and discarded_at is null and delivery_state='queued' and available_at<=now()
      order by attempts,available_at,created_at for update skip locked limit greatest(1,least(p_limit,100))
  ) update public.notification_outbox q set delivery_state='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=q.attempts+1
    from picked where q.id=picked.id returning q.*;
end;
$$;

create or replace function public.finish_attendance_notification(p_id uuid,p_lease uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_outcome not in ('accepted','retry','discarded','uncertain') then raise exception 'invalid_outcome'; end if;
  update public.notification_outbox set
    delivery_state=case when p_outcome='retry' and attempts<5 then 'queued' when p_outcome='retry' then 'discarded' else p_outcome end,
    sent_at=case when p_outcome='accepted' then now() else sent_at end,
    provider_accepted_at=case when p_outcome='accepted' then now() else provider_accepted_at end,
    discarded_at=case when p_outcome in ('discarded','uncertain') or p_outcome='retry' and attempts>=5 then now() else discarded_at end,
    available_at=case when p_outcome='retry' then now()+make_interval(secs=>least(3600,15*power(2,attempts)::integer)) else available_at end,
    last_error=left(p_error,300),lease_token=null,lease_until=null
    where id=p_id and lease_token=p_lease and delivery_state='sending' and lease_until>now();
  get diagnostics n=row_count;return n=1;
end;
$$;

-- These functions take device IDs and privileged data: only Edge service-role callers.
revoke all on function public.register_attendance_device(text,text,text,text),public.replace_attendance_schedules(uuid,bigint,jsonb,jsonb),public.record_attendance_event(uuid,jsonb),public.record_setup_summary(uuid,text,jsonb),public.enqueue_attendance_reminders(date),public.claim_attendance_notifications(integer),public.finish_attendance_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_attendance_device(text,text,text,text),public.replace_attendance_schedules(uuid,bigint,jsonb,jsonb),public.record_attendance_event(uuid,jsonb),public.record_setup_summary(uuid,text,jsonb),public.enqueue_attendance_reminders(date),public.claim_attendance_notifications(integer),public.finish_attendance_notification(uuid,uuid,text,text) to service_role;
