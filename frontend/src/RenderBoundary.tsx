import {Component,type ReactNode} from 'react';

export class RenderBoundary extends Component<{children:ReactNode;fallback?:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(this.state.failed)return this.props.fallback||<div className="notice error" role="alert">This part of the answer could not be displayed. Your chat is safe.<button onClick={()=>this.setState({failed:false})}>Try displaying again</button></div>;
    return this.props.children;
  }
}
