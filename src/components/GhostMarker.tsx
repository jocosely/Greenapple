export function GhostMarker({ cityName }: { cityName: string }) {
  return (
    <div className="grid cursor-grab select-none justify-items-center active:cursor-grabbing">
      <div className="greenapple-pin relative grid h-[50px] w-[50px] place-items-center">
        <div className="apple-leaf absolute left-[27px] top-[3px] z-20 h-[12px] w-[20px] -rotate-[25deg] rounded-[80%_10%_80%_10%] bg-[#f8f8f8] shadow-[inset_-4px_-4px_8px_rgba(0,0,0,0.16),0_5px_14px_rgba(0,0,0,0.34)]" />
        <div className="apple-stem absolute left-[23px] top-[7px] z-10 h-[13px] w-[5px] rotate-[18deg] rounded-full bg-[#ececec] shadow-[inset_-2px_-2px_4px_rgba(0,0,0,0.18)]" />
        <div className="apple-body relative mt-[9px] h-[38px] w-[40px] rounded-[46%_47%_52%_52%] bg-[radial-gradient(circle_at_30%_24%,#ffffff_0_16%,#f4f4f4_36%,#d9d9d9_72%,#bfbfbf_100%)] shadow-[inset_7px_8px_12px_rgba(255,255,255,0.55),inset_-9px_-9px_15px_rgba(0,0,0,0.24),0_10px_24px_rgba(0,0,0,0.5),0_0_0_3px_rgba(255,255,255,0.09),0_0_24px_rgba(255,255,255,0.12)]">
          <div className="absolute left-1/2 top-[-2px] h-[9px] w-[17px] -translate-x-1/2 rounded-b-full bg-black/18 blur-[1px]" />
          <div className="absolute left-[9px] top-[8px] h-[10px] w-[7px] rotate-[22deg] rounded-full bg-white/75 blur-[1px]" />
          <div className="absolute bottom-[3px] left-1/2 h-[5px] w-[14px] -translate-x-1/2 rounded-t-full bg-black/14" />
        </div>
      </div>
      <div className="mt-2 text-[28px] font-extrabold leading-none text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.8)]">
        {cityName}
      </div>
    </div>
  );
}
